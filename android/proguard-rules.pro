# ProGuard rules for Glass Swing
# Keep all Android classes
-keep class android.** { *; }
-keep class androidx.** { *; }

# Keep sensor and media classes
-keep class android.hardware.** { *; }
-keep class android.media.** { *; }

# Keep Kotlin
-keep class kotlin.Metadata { *; }
