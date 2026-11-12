package com.example.scankeyboard

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.graphics.Color
import android.media.AudioManager
import android.media.ToneGenerator
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class ScannerActivity : Activity() {

    private lateinit var previewView: PreviewView
    private lateinit var statusText: TextView
    private lateinit var cameraExecutor: ExecutorService
    private lateinit var barcodeScanner: BarcodeScanner
    private var camera: Camera? = null
    private var torchOn = false

    private var lastCode: String? = null
    private var lastCodeAt = 0L
    private var lastSeenAt = 0L
    private val processing = AtomicBoolean(false)
    private val tone by lazy { ToneGenerator(AudioManager.STREAM_NOTIFICATION, 85) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        cameraExecutor = Executors.newSingleThreadExecutor()
        val formats = Barcode.FORMAT_QR_CODE or
                Barcode.FORMAT_EAN_13 or Barcode.FORMAT_EAN_8 or
                Barcode.FORMAT_UPC_A or Barcode.FORMAT_UPC_E or
                Barcode.FORMAT_CODE_128 or Barcode.FORMAT_CODE_39 or
                Barcode.FORMAT_CODE_93 or Barcode.FORMAT_ITF or
                Barcode.FORMAT_CODABAR
        val options = BarcodeScannerOptions.Builder()
            .setBarcodeFormats(formats)
            .build()
        barcodeScanner = BarcodeScanning.getClient(options)

        buildUi()

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
            == PackageManager.PERMISSION_GRANTED) {
            startCamera()
        } else {
            ActivityCompat.requestPermissions(
                this, arrayOf(Manifest.permission.CAMERA), CAMERA_PERMISSION_REQUEST
            )
        }
    }

    private fun buildUi() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.BLACK)
        }

        val header = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(12, 8, 12, 8)
            setBackgroundColor(Color.rgb(16, 42, 67))
        }
        val title = TextView(this).apply {
            text = "QUÉT QR / BARCODE"
            textSize = 17f
            setTextColor(Color.WHITE)
            setPadding(8, 8, 8, 8)
        }
        val close = Button(this).apply {
            text = "ĐÓNG"
            setOnClickListener { finish() }
        }
        header.addView(title, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        header.addView(close)

        previewView = PreviewView(this).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        }
        statusText = TextView(this).apply {
            text = "Đang khởi tạo camera..."
            textSize = 15f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(12, 14, 12, 14)
        }

        val controls = LinearLayout(this).apply {
            gravity = Gravity.CENTER
            setPadding(8, 4, 8, 12)
            setBackgroundColor(Color.rgb(16, 42, 67))
        }
        val flash = Button(this).apply {
            text = "ĐÈN FLASH"
            setOnClickListener {
                torchOn = !torchOn
                camera?.cameraControl?.enableTorch(torchOn)
                text = if (torchOn) "TẮT FLASH" else "ĐÈN FLASH"
            }
        }
        controls.addView(flash)

        root.addView(header)
        root.addView(previewView, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f
        ))
        root.addView(statusText)
        root.addView(controls)
        setContentView(root)
    }

    private fun startCamera() {
        val providerFuture = ProcessCameraProvider.getInstance(this)
        providerFuture.addListener({
            val provider = providerFuture.get()
            val preview = Preview.Builder().build().also {
                it.setSurfaceProvider(previewView.surfaceProvider)
            }
            val analysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()

            analysis.setAnalyzer(cameraExecutor) { imageProxy ->
                val mediaImage = imageProxy.image
                if (mediaImage == null || !processing.compareAndSet(false, true)) {
                    imageProxy.close()
                    return@setAnalyzer
                }

                val image = InputImage.fromMediaImage(
                    mediaImage, imageProxy.imageInfo.rotationDegrees
                )
                barcodeScanner.process(image)
                    .addOnSuccessListener { barcodes ->
                        val now = System.currentTimeMillis()
                        val value = barcodes.firstNotNullOfOrNull { it.rawValue?.trim() }
                            ?.takeIf { it.isNotEmpty() }

                        if (value == null) {
                            if (now - lastSeenAt > RESET_AFTER_MS) {
                                lastCode = null
                            }
                        } else {
                            lastSeenAt = now
                            if (value != lastCode || now - lastCodeAt > SAME_CODE_COOLDOWN_MS) {
                                lastCode = value
                                lastCodeAt = now
                                runOnUiThread {
                                    statusText.text = "ĐÃ QUÉT: $value\nĐang tiếp tục quét..."
                                    tone.startTone(ToneGenerator.TONE_PROP_BEEP, 120)
                                }
                                ScanKeyboardService.deliverScannedCode(value)
                            }
                        }
                    }
                    .addOnFailureListener {
                        runOnUiThread { statusText.text = "Không đọc được mã. Hãy thử điều chỉnh khoảng cách." }
                    }
                    .addOnCompleteListener {
                        imageProxy.close()
                        processing.set(false)
                    }
            }

            try {
                provider.unbindAll()
                camera = provider.bindToLifecycle(
                    this as LifecycleOwner,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    preview,
                    analysis
                )
                statusText.text = "Sẵn sàng. Đưa mã vào khung camera."
            } catch (e: Exception) {
                statusText.text = "Không thể mở camera: ${e.localizedMessage}"
            }
        }, ContextCompat.getMainExecutor(this))
    }

    override fun onRequestPermissionsResult(
        requestCode: Int, permissions: Array<out String>, grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == CAMERA_PERMISSION_REQUEST &&
            grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            startCamera()
        } else {
            statusText.text = "Bạn cần cấp quyền camera để quét mã."
        }
    }

    override fun onDestroy() {
        try { barcodeScanner.close() } catch (_: Exception) {}
        if (::cameraExecutor.isInitialized) cameraExecutor.shutdown()
        try { tone.release() } catch (_: Exception) {}
        super.onDestroy()
    }

    companion object {
        private const val CAMERA_PERMISSION_REQUEST = 501
        private const val RESET_AFTER_MS = 900L
        private const val SAME_CODE_COOLDOWN_MS = 1800L
    }
}
