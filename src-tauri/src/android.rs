//! Pont natif Android via JNI : applications installées, volume, touches
//! média, lampe torche, service d'overlay et configuration d'automatisations.
#![cfg(target_os = "android")]

use jni::objects::{JObject, JString, JValue};
use jni::JNIEnv;
use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicBool, Ordering};

static NDK_READY: AtomicBool = AtomicBool::new(false);

/// Appelé par MainActivity.onCreate : fournit la JavaVM et le Context à
/// ndk-context. Sans cette initialisation, `android_context()` panique et
/// un panic qui traverse la frontière JNI abat tout le processus.
#[no_mangle]
pub extern "system" fn Java_ai_landcapital_rubilax_MainActivity_initNdk(
    mut env: JNIEnv,
    activity: JObject,
) {
    // l'activité peut être recréée (rotation, thème) : une seule init
    if NDK_READY.swap(true, Ordering::SeqCst) {
        return;
    }
    let init = (|| -> Result<(), jni::errors::Error> {
        let vm = env.get_java_vm()?;
        let app = env
            .call_method(
                &activity,
                "getApplicationContext",
                "()Landroid/content/Context;",
                &[],
            )?
            .l()?;
        let global = env.new_global_ref(app)?;
        unsafe {
            ndk_context::initialize_android_context(
                vm.get_java_vm_pointer().cast(),
                global.as_raw().cast(),
            );
        }
        // la référence globale doit vivre aussi longtemps que le processus
        std::mem::forget(global);
        Ok(())
    })();
    if init.is_err() {
        let _ = env.exception_clear();
        NDK_READY.store(false, Ordering::SeqCst);
    }
}

/// Exécute `f` avec un JNIEnv attaché et le Context applicatif. Toute
/// erreur (ou panic) devient un `Err` propre au lieu de tuer le processus.
fn with_context<R>(
    f: impl FnOnce(&mut JNIEnv, &JObject) -> Result<R, Box<dyn std::error::Error>>,
) -> Result<R, String> {
    std::panic::catch_unwind(AssertUnwindSafe(|| {
        let ctx = ndk_context::android_context();
        let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }.map_err(|e| e.to_string())?;
        let context = unsafe { JObject::from_raw(ctx.context().cast()) };
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        f(&mut env, &context).map_err(|e| {
            // vider une éventuelle exception Java pour ne pas empoisonner la VM
            let _ = env.exception_clear();
            e.to_string()
        })
    }))
    .map_err(|_| "pont natif Android indisponible".to_string())?
}

fn get_system_service<'a>(
    env: &mut JNIEnv<'a>,
    context: &JObject,
    name: &str,
) -> Result<JObject<'a>, Box<dyn std::error::Error>> {
    let service_name = env.new_string(name)?;
    let service = env
        .call_method(
            context,
            "getSystemService",
            "(Ljava/lang/String;)Ljava/lang/Object;",
            &[JValue::Object(&service_name)],
        )?
        .l()?;
    Ok(service)
}

/// Liste (label, package) des applications lançables.
pub fn list_apps() -> Result<Vec<(String, String)>, String> {
    with_context(|env, context| {
        let pm = env
            .call_method(
                context,
                "getPackageManager",
                "()Landroid/content/pm/PackageManager;",
                &[],
            )?
            .l()?;

        let action = env.new_string("android.intent.action.MAIN")?;
        let intent_class = env.find_class("android/content/Intent")?;
        let intent = env.new_object(
            &intent_class,
            "(Ljava/lang/String;)V",
            &[JValue::Object(&action)],
        )?;
        let category = env.new_string("android.intent.category.LAUNCHER")?;
        env.call_method(
            &intent,
            "addCategory",
            "(Ljava/lang/String;)Landroid/content/Intent;",
            &[JValue::Object(&category)],
        )?;

        let list = env
            .call_method(
                &pm,
                "queryIntentActivities",
                "(Landroid/content/Intent;I)Ljava/util/List;",
                &[JValue::Object(&intent), JValue::Int(0)],
            )?
            .l()?;
        let size = env.call_method(&list, "size", "()I", &[])?.i()?;

        let mut apps = Vec::new();
        for i in 0..size {
            let resolve_info = env
                .call_method(&list, "get", "(I)Ljava/lang/Object;", &[JValue::Int(i)])?
                .l()?;
            let label = env
                .call_method(
                    &resolve_info,
                    "loadLabel",
                    "(Landroid/content/pm/PackageManager;)Ljava/lang/CharSequence;",
                    &[JValue::Object(&pm)],
                )?
                .l()?;
            let label_str = env
                .call_method(&label, "toString", "()Ljava/lang/String;", &[])?
                .l()?;
            let label_str: String = env.get_string(&JString::from(label_str))?.into();

            let activity_info = env
                .get_field(
                    &resolve_info,
                    "activityInfo",
                    "Landroid/content/pm/ActivityInfo;",
                )?
                .l()?;
            let package = env
                .get_field(&activity_info, "packageName", "Ljava/lang/String;")?
                .l()?;
            let package: String = env.get_string(&JString::from(package))?.into();

            apps.push((label_str, package));
        }
        Ok(apps)
    })
}

/// Lance une application par son package.
pub fn launch_package(package: &str) -> Result<(), String> {
    with_context(|env, context| {
        let pm = env
            .call_method(
                context,
                "getPackageManager",
                "()Landroid/content/pm/PackageManager;",
                &[],
            )?
            .l()?;
        let pkg = env.new_string(package)?;
        let intent = env
            .call_method(
                &pm,
                "getLaunchIntentForPackage",
                "(Ljava/lang/String;)Landroid/content/Intent;",
                &[JValue::Object(&pkg)],
            )?
            .l()?;
        if intent.is_null() {
            return Err("aucun écran de lancement pour ce package".into());
        }
        // lancement depuis le Context applicatif : NEW_TASK obligatoire
        env.call_method(
            &intent,
            "addFlags",
            "(I)Landroid/content/Intent;",
            &[JValue::Int(0x1000_0000)],
        )?;
        env.call_method(
            context,
            "startActivity",
            "(Landroid/content/Intent;)V",
            &[JValue::Object(&intent)],
        )?;
        Ok(())
    })
}

/// Volume médias : "up" | "down" | "mute" | "unmute".
pub fn adjust_volume(action: &str) -> Result<(), String> {
    let direction = match action {
        "up" => 1,        // ADJUST_RAISE
        "down" => -1,     // ADJUST_LOWER
        "mute" => -100,   // ADJUST_MUTE
        "unmute" => 100,  // ADJUST_UNMUTE
        _ => return Err("action inconnue".into()),
    };
    with_context(|env, context| {
        let audio = get_system_service(env, context, "audio")?;
        // STREAM_MUSIC = 3, FLAG_SHOW_UI = 1
        env.call_method(
            &audio,
            "adjustStreamVolume",
            "(III)V",
            &[JValue::Int(3), JValue::Int(direction), JValue::Int(1)],
        )?;
        Ok(())
    })
}

/// Touches média : "playpause" | "next" | "previous".
pub fn media_key(action: &str) -> Result<(), String> {
    let keycode = match action {
        "playpause" => 85, // KEYCODE_MEDIA_PLAY_PAUSE
        "next" => 87,      // KEYCODE_MEDIA_NEXT
        "previous" => 88,  // KEYCODE_MEDIA_PREVIOUS
        _ => return Err("action inconnue".into()),
    };
    with_context(|env, context| {
        let audio = get_system_service(env, context, "audio")?;
        let key_event_class = env.find_class("android/view/KeyEvent")?;
        for action_code in [0i32, 1i32] {
            // ACTION_DOWN puis ACTION_UP
            let event = env.new_object(
                &key_event_class,
                "(II)V",
                &[JValue::Int(action_code), JValue::Int(keycode)],
            )?;
            env.call_method(
                &audio,
                "dispatchMediaKeyEvent",
                "(Landroid/view/KeyEvent;)V",
                &[JValue::Object(&event)],
            )?;
        }
        Ok(())
    })
}

/// Lampe torche on/off. Renvoie l'état appliqué.
pub fn set_torch(on: bool) -> Result<bool, String> {
    with_context(|env, context| {
        let camera = get_system_service(env, context, "camera")?;
        let ids = env
            .call_method(&camera, "getCameraIdList", "()[Ljava/lang/String;", &[])?
            .l()?;
        let ids: jni::objects::JObjectArray = ids.into();
        let count = env.get_array_length(&ids)?;
        if count == 0 {
            return Err("aucune caméra".into());
        }
        // la caméra 0 (dorsale) porte le flash sur l'immense majorité des téléphones
        let id = env.get_object_array_element(&ids, 0)?;
        env.call_method(
            &camera,
            "setTorchMode",
            "(Ljava/lang/String;Z)V",
            &[JValue::Object(&id), JValue::Bool(on as u8)],
        )?;
        Ok(on)
    })
}

/// Démarre / arrête le service natif de l'œil flottant.
pub fn overlay_service(start: bool) -> Result<(), String> {
    with_context(|env, context| {
        let class_name = env.new_string("ai.landcapital.rubilax.FendoirOverlayService")?;
        let pkg = env.new_string("ai.landcapital.rubilax")?;
        let intent_class = env.find_class("android/content/Intent")?;
        let intent = env.new_object(&intent_class, "()V", &[])?;
        env.call_method(
            &intent,
            "setClassName",
            "(Ljava/lang/String;Ljava/lang/String;)Landroid/content/Intent;",
            &[JValue::Object(&pkg), JValue::Object(&class_name)],
        )?;
        if start {
            env.call_method(
                context,
                "startForegroundService",
                "(Landroid/content/Intent;)Landroid/content/ComponentName;",
                &[JValue::Object(&intent)],
            )?;
        } else {
            env.call_method(
                context,
                "stopService",
                "(Landroid/content/Intent;)Z",
                &[JValue::Object(&intent)],
            )?;
        }
        Ok(())
    })
}

/// L'app a-t-elle la permission « par-dessus les autres apps » ?
pub fn can_draw_overlays() -> Result<bool, String> {
    with_context(|env, context| {
        let settings = env.find_class("android/provider/Settings")?;
        let ok = env
            .call_static_method(
                settings,
                "canDrawOverlays",
                "(Landroid/content/Context;)Z",
                &[JValue::Object(context)],
            )?
            .z()?;
        Ok(ok)
    })
}

/// Ouvre l'écran système pour accorder la permission d'overlay.
pub fn request_overlay_permission() -> Result<(), String> {
    with_context(|env, context| {
        let action = env.new_string("android.settings.action.MANAGE_OVERLAY_PERMISSION")?;
        let uri_str = env.new_string("package:ai.landcapital.rubilax")?;
        let uri_class = env.find_class("android/net/Uri")?;
        let uri = env
            .call_static_method(
                uri_class,
                "parse",
                "(Ljava/lang/String;)Landroid/net/Uri;",
                &[JValue::Object(&uri_str)],
            )?
            .l()?;
        let intent_class = env.find_class("android/content/Intent")?;
        let intent = env.new_object(
            &intent_class,
            "(Ljava/lang/String;Landroid/net/Uri;)V",
            &[JValue::Object(&action), JValue::Object(&uri)],
        )?;
        // FLAG_ACTIVITY_NEW_TASK = 0x10000000
        env.call_method(
            &intent,
            "addFlags",
            "(I)Landroid/content/Intent;",
            &[JValue::Int(0x1000_0000)],
        )?;
        env.call_method(
            context,
            "startActivity",
            "(Landroid/content/Intent;)V",
            &[JValue::Object(&intent)],
        )?;
        Ok(())
    })
}
