import android.Manifest
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.media.MediaPlayer
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import kotlin.math.sqrt

class MainActivity : AppCompatActivity(), SensorEventListener {

    private lateinit var sensorManager: SensorManager
    private var accelerometer: Sensor? = null
    private var mediaPlayer: MediaPlayer? = null

    // Sound pool approach for low-latency
    private var soundPool: android.media.SoundPool? = null
    private var soundIds = mutableListOf<Int>()
    private val sounds = listOf(
        "glass_break_window",
        "glass_break_rock",
        "glass_break_crash"
    )

    // UI
    private lateinit var glassPane: ImageView
    private lateinit var crackOverlay: ImageView
    private lateinit var swingBtn: ImageButton
    private lateinit var resetBtn: ImageButton
    private lateinit var statusText: TextView

    // Swing detection state
    private var isArmed = false
    private var lastSwingTime = 0L
    private var lastMagnitude = 0.0f
    private var smoothedX = 0.0f
    private var smoothedY = 0.0f
    private var smoothedZ = 0.0f
    private var shatterCount = 0
    private val COOLDOWN_MS = 1500L
    private val SWING_THRESHOLD = 25f

    // Handler for UI effects
    private val handler = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Full screen
        window.decorView.windowInsetsController?.let { controller ->
            controller.hide(WindowInsets.Type.statusBars())
        }

        setContentView(R.layout.activity_main)

        // Init views
        glassPane = findViewById(R.id.glassPane)
        crackOverlay = findViewById(R.id.crackOverlay)
        swingBtn = findViewById(R.id.swingBtn)
        resetBtn = findViewById(R.id.resetBtn)
        statusText = findViewById(R.id.statusText)

        // Init sensor manager
        sensorManager = getSystemService(SENSOR_SERVICE) as SensorManager
        accelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)

        // Load sounds
        loadSounds()

        // Button listeners
        swingBtn.setOnClickListener {
            isArmed = true
            updateStatus("Swing detection active! 🎯")
            swingBtn.setImageResource(R.drawable.ic_swing_on)
            Toast.makeText(this, "Swing your phone!", Toast.LENGTH_SHORT).show()
        }

        resetBtn.setOnClickListener {
            resetGlass()
        }
    }

    private fun loadSounds() {
        soundPool = android.media.SoundPool.Builder()
            .setMaxStreams(3)
            .setAudioAttributes(
                android.media.AudioAttributes.Builder()
                    .setUsage(android.media.AudioAttributes.USAGE_GAME)
                    .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            )
            .build()

        for (sound in sounds) {
            val resId = resources.getIdentifier(sound, "raw", packageName)
            if (resId != 0) {
                val id = soundPool?.load(this, resId, 1)
                if (id != null) {
                    soundIds.add(id)
                }
            }
        }

        // Fallback to MediaPlayer if SoundPool fails
        if (soundIds.isEmpty()) {
            try {
                val resId = resources.getIdentifier("glass_break_window", "raw", packageName)
                if (resId != 0) {
                    mediaPlayer = MediaPlayer.create(this, resId)
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        if (isArmed && accelerometer != null) {
            sensorManager.registerListener(this, accelerometer!!, SensorManager.SENSOR_DELAY_GAME)
        }
    }

    override fun onPause() {
        super.onPause()
        sensorManager.unregisterListener(this)
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        // Not needed
    }

    override fun onSensorChanged(event: SensorEvent?) {
        if (!isArmed || event == null) return

        val x = event.values[0]
        val y = event.values[1]
        val z = event.values[2]

        // Exponential moving average smooth
        val alpha = 0.15f
        smoothedX = alpha * x + (1 - alpha) * smoothedX
        smoothedY = alpha * y + (1 - alpha) * smoothedY
        smoothedZ = alpha * z + (1 - alpha) * smoothedZ

        // Magnitude (includes gravity ~9.8)
        val magnitude = sqrt(smoothedX * smoothedX + smoothedY * smoothedY + smoothedZ * smoothedZ)

        // Delta from last reading — swing is a sudden change
        val delta = Math.abs(magnitude - lastMagnitude)
        lastMagnitude = magnitude

        val now = System.currentTimeMillis()

        if (delta > SWING_THRESHOLD && now - lastSwingTime > COOLDOWN_MS) {
            lastSwingTime = now
            triggerShatter()
        }
    }

    private fun triggerShatter() {
        shatterCount++

        // Vibrate
        val vibrator = getSystemService(VIBRATOR_SERVICE) as android.os.Vibrator
        vibrator.vibrate(android.os.VibrationEffect.createOneShot(300, android.os.VibrationEffect.DEFAULT_AMPLITUDE))

        // Show crack
        crackOverlay.setImageResource(R.drawable.crack_overlay)
        crackOverlay.alpha = 0.7f
        crackOverlay.visibility = ImageView.VISIBLE

        // Flash effect
        glassPane.alpha = 0.3f
        handler.postDelayed({ glassPane.alpha = 1f }, 150)

        // Play sound
        playSound()

        // Switch to shatter state
        isArmed = false
        swingBtn.setImageResource(R.drawable.ic_reset)
        updateStatus("💥 Shattered! ($shatterCount total)")

        // Auto-reset after 2 seconds
        handler.postDelayed({ resetGlass() }, 2000)
    }

    private fun playSound() {
        if (soundIds.isNotEmpty() && soundPool != null) {
            val idx = (soundIds.indices).random()
            soundPool?.play(soundIds[idx], 1f, 1f, 0, 0, 1f)
        } else if (mediaPlayer != null) {
            mediaPlayer?.seekTo(0)
            mediaPlayer?.start()
        }
    }

    private fun resetGlass() {
        isArmed = true
        crackOverlay.visibility = ImageView.GONE
        crackOverlay.alpha = 0f
        swingBtn.setImageResource(R.drawable.ic_swing_on)
        updateStatus("Ready. Swing your phone!")
    }

    private fun updateStatus(text: String) {
        statusText.text = text
    }

    override fun onDestroy() {
        super.onDestroy()
        soundPool?.release()
        mediaPlayer?.release()
    }
}
