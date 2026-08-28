package com.shivax.rubilax

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import kotlin.math.abs

/**
 * L'œil de Rubilax flottant par-dessus les autres applications.
 * Glisser pour le déplacer, toucher pour ouvrir l'app, appui long pour lui
 * parler (reconnaissance vocale). Il se range via l'interrupteur des réglages.
 */
class FendoirOverlayService : Service() {

    private var windowManager: WindowManager? = null
    private var eye: EyeView? = null
    private val powerReceiver = PowerReceiver()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        startInForeground()
        addEyeOverlay()
        // les broadcasts chargeur/batterie n'atteignent pas le manifest
        // depuis Android 8 : c'est ce service qui les écoute, app fermée
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(powerReceiver, PowerReceiver.FILTER, RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(powerReceiver, PowerReceiver.FILTER)
        }
    }

    // si le système nous tue (mémoire, économiseur…), qu'il nous relance
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    // l'app retirée des récents ne doit pas emporter l'œil avec elle
    override fun onTaskRemoved(rootIntent: Intent?) {
        val restart = Intent(applicationContext, FendoirOverlayService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(restart)
        } else {
            startService(restart)
        }
        super.onTaskRemoved(rootIntent)
    }

    private fun startInForeground() {
        val channelId = "fendoir_overlay"
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(channelId, "Œil flottant", NotificationManager.IMPORTANCE_MIN)
            )
        }
        val openIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        val notification: Notification = (
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                Notification.Builder(this, channelId)
            else
                @Suppress("DEPRECATION") Notification.Builder(this)
            )
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Rubilax veille")
            .setContentText("Touche l'œil : ouvrir. Appui long : lui parler.")
            .setContentIntent(openIntent)
            .setOngoing(true)
            .build()
        startForeground(1663, notification)
    }

    private fun addEyeOverlay() {
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        val density = resources.displayMetrics.density
        val size = (72 * density).toInt()

        val params = WindowManager.LayoutParams(
            size, size,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else
                @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        )
        params.gravity = Gravity.TOP or Gravity.START
        params.x = resources.displayMetrics.widthPixels - size - (12 * density).toInt()
        params.y = (140 * density).toInt()

        // l'œil vivant : il cligne, sa pupille vagabonde, il réagit
        val view = EyeView(this)
        view.elevation = 8f

        var downX = 0f
        var downY = 0f
        var startX = 0
        var startY = 0
        var moved = false
        var downAt = 0L

        view.setOnTouchListener(object : View.OnTouchListener {
            override fun onTouch(v: View, event: MotionEvent): Boolean {
                when (event.action) {
                    MotionEvent.ACTION_DOWN -> {
                        downX = event.rawX
                        downY = event.rawY
                        startX = params.x
                        startY = params.y
                        moved = false
                        downAt = System.currentTimeMillis()
                        view.pressedLook = true
                        return true
                    }
                    MotionEvent.ACTION_MOVE -> {
                        val dx = event.rawX - downX
                        val dy = event.rawY - downY
                        if (abs(dx) > 12 || abs(dy) > 12) moved = true
                        params.x = startX + dx.toInt()
                        params.y = startY + dy.toInt()
                        windowManager?.updateViewLayout(v, params)
                        return true
                    }
                    MotionEvent.ACTION_UP -> {
                        view.pressedLook = false
                        val pressTime = System.currentTimeMillis() - downAt
                        if (!moved) {
                            val intent = Intent(this@FendoirOverlayService, MainActivity::class.java)
                            intent.addFlags(
                                Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
                            )
                            if (pressTime > 600) {
                                // appui long : ouvrir en écoute vocale
                                intent.putExtra(MainActivity.EXTRA_VOICE, true)
                                view.listeningLook = true
                                view.postDelayed({ view.listeningLook = false }, 4000)
                            }
                            startActivity(intent)
                        }
                        return true
                    }
                }
                return false
            }
        })

        eye = view
        windowManager?.addView(view, params)
    }

    override fun onDestroy() {
        try {
            unregisterReceiver(powerReceiver)
        } catch (_: Exception) {
        }
        eye?.let { windowManager?.removeView(it) }
        eye = null
        super.onDestroy()
    }
}
