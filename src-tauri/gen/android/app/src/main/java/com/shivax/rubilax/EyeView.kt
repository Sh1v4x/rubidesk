package com.shivax.rubilax

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.os.BatteryManager
import android.view.View
import kotlin.math.min
import kotlin.random.Random

/**
 * L'œil vivant de Rubilax pour la bulle flottante : il cligne, sa pupille
 * vagabonde, un halo doré apparaît quand l'appareil charge, et il
 * s'écarquille sous le doigt (halo braise pendant l'écoute vocale).
 */
class EyeView(context: Context) : View(context) {

    /** doigt posé : la pupille se dilate */
    var pressedLook = false

    /** écoute vocale déclenchée : halo braise quelques secondes */
    var listeningLook = false

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val arcRect = RectF()
    private val clip = Path()

    private var pupilX = 0f
    private var pupilY = 0f
    private var targetX = 0f
    private var targetY = 0f
    private var nextWanderAt = 0L
    private var blinkStart = 0L
    private var nextBlinkAt = System.currentTimeMillis() + 2500
    private var charging = false
    private var lastBatteryCheck = 0L

    private val ticker = object : Runnable {
        override fun run() {
            val now = System.currentTimeMillis()
            if (now >= nextWanderAt) {
                val reach = min(width, height) * 0.06f
                targetX = (Random.nextFloat() * 2 - 1) * reach
                targetY = (Random.nextFloat() * 2 - 1) * reach * 0.7f
                nextWanderAt = now + 1800 + Random.nextInt(2600)
            }
            pupilX += (targetX - pupilX) * 0.08f
            pupilY += (targetY - pupilY) * 0.08f
            if (now >= nextBlinkAt) {
                blinkStart = now
                nextBlinkAt = now + 3200 + Random.nextInt(4200)
            }
            if (now - lastBatteryCheck > 5000) {
                lastBatteryCheck = now
                val battery = context.registerReceiver(
                    null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)
                )
                charging = (battery?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0) != 0
            }
            invalidate()
            postDelayed(this, 40)
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        post(ticker)
    }

    override fun onDetachedFromWindow() {
        removeCallbacks(ticker)
        super.onDetachedFromWindow()
    }

    override fun onDraw(canvas: Canvas) {
        val cx = width / 2f
        val cy = height / 2f
        val r = min(width, height) / 2f - 5f
        paint.style = Paint.Style.FILL

        // halo : doré en charge, braise vive pendant l'écoute
        if (charging || listeningLook) {
            paint.color = if (listeningLook) 0x66FF7A1A.toInt() else 0x40FFB02E.toInt()
            canvas.drawCircle(cx, cy, r + 5f, paint)
        }

        // anneaux (repris de l'œil du Fendoir)
        paint.color = 0xFF1B0803.toInt()
        canvas.drawCircle(cx, cy, r, paint)
        paint.color = 0xFFA93A17.toInt()
        canvas.drawCircle(cx, cy, r * 0.94f, paint)
        paint.color = 0xFFD3612F.toInt() // reflet haut de l'anneau
        arcRect.set(cx - r * 0.94f, cy - r * 0.94f, cx + r * 0.94f, cy + r * 0.94f)
        canvas.drawArc(arcRect, 200f, 120f, true, paint)
        paint.color = 0xFF140D08.toInt()
        canvas.drawCircle(cx, cy, r * 0.8f, paint)
        paint.color = 0xFFE9DCC0.toInt() // sclère crème
        canvas.drawCircle(cx, cy, r * 0.74f, paint)

        // iris + pupille, qui suivent la dérive et se dilatent sous le doigt
        val ir = r * (if (pressedLook) 0.5f else 0.44f)
        val px = cx + pupilX
        val py = cy + pupilY
        paint.color = 0xFFF59A2C.toInt()
        canvas.drawCircle(px, py, ir, paint)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = ir * 0.2f
        paint.color = 0xFFC9490F.toInt()
        canvas.drawCircle(px, py, ir * 0.9f, paint)
        paint.style = Paint.Style.FILL
        paint.color = 0xFF0A0604.toInt()
        canvas.drawCircle(px, py, ir * (if (pressedLook) 0.62f else 0.5f), paint)
        paint.color = 0xE6FFFFFF.toInt()
        canvas.drawCircle(px - ir * 0.35f, py - ir * 0.38f, ir * 0.2f, paint)

        // clignement : les paupières balaient la sclère un court instant
        val elapsed = System.currentTimeMillis() - blinkStart
        if (elapsed in 0..239) {
            val phase = elapsed / 240f
            val closed = if (phase < 0.5f) phase * 2 else (1 - phase) * 2
            canvas.save()
            clip.reset()
            clip.addCircle(cx, cy, r * 0.74f, Path.Direction.CW)
            canvas.clipPath(clip)
            paint.color = 0xFF2A1810.toInt()
            val sweep = r * 0.78f * closed
            canvas.drawRect(cx - r, cy - r, cx + r, cy - r * 0.74f + sweep, paint)
            canvas.drawRect(cx - r, cy + r * 0.74f - sweep, cx + r, cy + r, paint)
            canvas.restore()
        }
    }
}
