# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# Vosk (mot d'éveil) passe par JNA, dont le code natif retrouve classes,
# champs (Pointer.peer) et méthodes PAR NOM : R8 ne doit ni les renommer
# ni les élaguer, sinon UnsatisfiedLinkError au démarrage du WakeService.
-keep class com.sun.jna.** { *; }
-keepclassmembers class * extends com.sun.jna.Structure { *; }
-keep class org.vosk.** { *; }
# JNA référence java.awt, absent d'Android : avertissements à ignorer
-dontwarn java.awt.**