package com.example.scankeyboard

import android.content.Intent
import android.inputmethodservice.InputMethodService
import android.view.View
import android.view.Gravity
import android.view.inputmethod.InputConnection
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.graphics.Color
import android.view.KeyEvent
import java.lang.ref.WeakReference

class ScanKeyboardService : InputMethodService() {

    private var targetConnection: InputConnection? = null

    override fun onStartInput(attribute: android.view.inputmethod.EditorInfo?, restarting: Boolean) {
        super.onStartInput(attribute, restarting)
        targetConnection = currentInputConnection
        activeService = WeakReference(this)
    }

    override fun onCreateInputView(): View {
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(12, 10, 12, 10)
            setBackgroundColor(Color.rgb(232, 239, 247))
        }

        val scanButton = Button(this).apply {
            text = "📷  QUÉT MÃ"
            textSize = 16f
            setOnClickListener { openScanner() }
        }
        val enterButton = Button(this).apply {
            text = "ENTER"
            setOnClickListener { sendEnter(targetConnection) }
        }
        val closeButton = Button(this).apply {
            text = "ẨN"
            setOnClickListener { requestHideSelf(0) }
        }

        bar.addView(scanButton, LinearLayout.LayoutParams(0, 56, 2f))
        bar.addView(enterButton, LinearLayout.LayoutParams(0, 56, 1f))
        bar.addView(closeButton, LinearLayout.LayoutParams(0, 56, 1f))
        return bar
    }

    private fun openScanner() {
        // Lưu InputConnection của ô nhập trên Chrome trước khi mở màn hình camera.
        targetConnection = currentInputConnection ?: targetConnection
        val intent = Intent(this, ScannerActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        startActivity(intent)
    }

    private fun sendEnter(connection: InputConnection?) {
        if (connection == null) return
        val down = KeyEvent(
            KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER
        ).also { it.flags = it.flags or KeyEvent.FLAG_SOFT_KEYBOARD or KeyEvent.FLAG_KEEP_TOUCH_MODE }
        val up = KeyEvent(
            KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ENTER
        ).also { it.flags = it.flags or KeyEvent.FLAG_SOFT_KEYBOARD or KeyEvent.FLAG_KEEP_TOUCH_MODE }
        connection.sendKeyEvent(down)
        connection.sendKeyEvent(up)
    }

    private fun deliverCode(code: String) {
        val connection = targetConnection ?: currentInputConnection ?: return
        connection.commitText(code, 1)
        sendEnter(connection)
    }

    companion object {
        @Volatile
        private var activeService: WeakReference<ScanKeyboardService>? = null

        fun deliverScannedCode(code: String) {
            activeService?.get()?.let { service ->
                service.runOnMain {
                    service.deliverCode(code)
                }
            }
        }
    }

    private fun runOnMain(action: () -> Unit) {
        if (android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) {
            action()
        } else {
            android.os.Handler(android.os.Looper.getMainLooper()).post(action)
        }
    }

    override fun onDestroy() {
        activeService?.clear()
        super.onDestroy()
    }
}
