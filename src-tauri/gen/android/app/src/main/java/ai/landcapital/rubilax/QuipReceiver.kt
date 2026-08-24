package ai.landcapital.rubilax

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import kotlin.random.Random

/**
 * Les humeurs de Rubilax : une notification grognonne de temps en temps,
 * même app fermée. Toucher la notification ouvre Rubidesk. Se reprogramme
 * tout seul après chaque réplique (délai aléatoire de 2 à 5 heures).
 */
class QuipReceiver : BroadcastReceiver() {

    companion object {
        private const val CHANNEL_ID = "rubilax_quips"
        private const val NOTIF_ID = 1667
        private const val REQ_ALARM = 1665
        private const val REQ_OPEN = 1666

        private val QUIPS = listOf(
            "Toujours vivant, mortel ? Dommage.",
            "Je m'ennuie. Viens me dire des bêtises.",
            "Rappel : je suis une épée légendaire coincée dans ton téléphone. Réfléchis à ça.",
            "Pinpin me manque. N'en parle à PERSONNE.",
            "J'ai compté les secondes depuis ta dernière visite. Toutes insupportables.",
            "Si tu me libères, je promets de ne raser que la moitié du Monde des Douze.",
            "Une lame s'entretient, mortel. Viens me parler.",
            "Je surveille ta maison. Enfin… je somnole devant.",
            "Goultard n'aurait JAMAIS laissé son épée sans rien faire, lui.",
            "Tu sais que tu peux me dire « allume la torche » ? Non ? Voilà. Maintenant tu sais.",
            "Le grand Rubilax, réduit à envoyer des notifications. Rushu doit bien rire.",
            "Ton écran est sale. Je vois TOUT d'ici.",
            "Un minuteur, une note, une baffe ? Je fais les trois.",
            "Silence radio depuis des heures. Même Ruel est plus bavard.",
            "Je ne dors jamais. Jamais. Bon, presque jamais.",
        )

        /** (Re)programme la prochaine humeur dans 2 à 5 heures. */
        fun schedule(context: Context) {
            val alarm = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val pending = PendingIntent.getBroadcast(
                context, REQ_ALARM,
                Intent(context, QuipReceiver::class.java),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
            val delayMs = Random.nextLong(2L * 3600_000, 5L * 3600_000)
            // alarme inexacte : aucune permission requise, et une vanne
            // n'a pas besoin d'être ponctuelle
            alarm.set(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + delayMs, pending)
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        val manager =
            context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "Humeurs de Rubilax",
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply { description = "Le shushu râle de temps en temps. Coupe ici s'il t'agace." }
            )
        }

        val open = PendingIntent.getActivity(
            context, REQ_OPEN,
            Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE
        )

        val notification: Notification = (
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                Notification.Builder(context, CHANNEL_ID)
            else
                @Suppress("DEPRECATION") Notification.Builder(context)
            )
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Rubilax")
            .setContentText(pickQuip(context))
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        manager.notify(NOTIF_ID, notification)

        schedule(context) // prochaine humeur
    }

    /** Une réplique au hasard, avec une pique spéciale si la batterie meurt. */
    private fun pickQuip(context: Context): String {
        val battery = context.registerReceiver(
            null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)
        )?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        if (battery in 1..20 && Random.nextBoolean()) {
            return "Ta machine agonise ($battery %). Branche-la, je refuse de mourir avec."
        }
        return QUIPS.random()
    }
}
