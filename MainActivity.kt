package com.example.scankeyboard

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.inputmethod.InputMethodManager
import android.content.Context
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.view.Gravity
import android.view.ViewGroup
import android.graphics.Color
import android.graphics.Typeface

class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(28, 36, 28, 36)
            setBackgroundColor(Color.rgb(245, 248, 252))
        }

        val title = TextView(this).apply {
            text = "SCAN KEYBOARD"
            textSize = 25f
            setTextColor(Color.rgb(20, 43, 66))
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
        }
        val description = TextView(this).apply {
            text = "Bàn phím Android quét mã QR và mã vạch bằng camera."
            textSize = 16f
            setTextColor(Color.DKGRAY)
            gravity = Gravity.CENTER
            setPadding(0, 18, 0, 28)
        }
        val settingsButton = Button(this).apply {
            text = "1. Bật Scan Keyboard"
            setOnClickListener {
                startActivity(Intent("android.settings.INPUT_METHOD_SETTINGS"))
            }
        }
        val pickerButton = Button(this).apply {
            text = "2. Chọn Scan Keyboard"
            setOnClickListener {
                val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
                imm.showInputMethodPicker()
            }
        }
        val testButton = Button(this).apply {
            text = "Mở màn hình quét thử"
            setOnClickListener {
                startActivity(Intent(this@MainActivity, ScannerActivity::class.java))
            }
        }
        val note = TextView(this).apply {
            text = "Sau khi bật và chọn bàn phím, mở Chrome, chạm vào ô nhập mã rồi nhấn nút SCAN trên bàn phím."
            textSize = 13f
            setTextColor(Color.GRAY)
            gravity = Gravity.CENTER
            setPadding(0, 20, 0, 0)
        }

        root.addView(title, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ))
        root.addView(description)
        root.addView(settingsButton, fullWidthParams())
        root.addView(pickerButton, fullWidthParams())
        root.addView(testButton, fullWidthParams())
        root.addView(note)
        setContentView(root)
    }

    private fun fullWidthParams() = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT
    ).apply { setMargins(0, 8, 0, 8) }
}
