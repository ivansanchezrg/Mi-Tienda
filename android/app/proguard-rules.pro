# ============================================================
# ProGuard / R8 rules — Mi Tienda
# ============================================================
# Las reglas por defecto (proguard-android-optimize.txt) cubren Android SDK
# y AndroidX. Aquí solo agregamos reglas específicas del stack de la app:
# Capacitor, plugins nativos, y librerías de terceros que usan reflection.
# ============================================================

# ----- Preservar línea/source para stack traces legibles en Crashlytics/Sentry -----
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# ----- Capacitor core -----
-keep class com.getcapacitor.** { *; }
-keep interface com.getcapacitor.** { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin { *; }
-keepclasseswithmembers class * {
    @com.getcapacitor.PluginMethod <methods>;
    @com.getcapacitor.annotation.CapacitorPlugin <methods>;
}

# ----- Capacitor plugins instalados -----
-keep class com.capacitorjs.plugins.** { *; }
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.vision.** { *; }

# ----- Cordova bridge (si Capacitor lo carga internamente) -----
-keep class org.apache.cordova.** { *; }

# ----- WebView ↔ JS bridge: preservar interfaces JavaScriptInterface -----
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ----- Supabase / OkHttp / Okio (red HTTP usada por supabase-js, aunque sea desde el WebView) -----
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }

# ----- Gson / kotlinx.serialization (si alguna lib nativa los usa) -----
-keepattributes Signature
-keepattributes *Annotation*
-keepclassmembers,allowobfuscation class * {
    @com.google.gson.annotations.SerializedName <fields>;
}

# ----- Retrofit / Reflection (si una librería plugin lo trae) -----
-keepattributes RuntimeVisibleAnnotations,RuntimeVisibleParameterAnnotations
-keep,allowobfuscation,allowshrinking class kotlin.coroutines.Continuation

# ----- Reglas defensivas: ignorar warnings de librerías opcionales -----
-dontwarn java.lang.invoke.**
-dontwarn javax.annotation.**

# ----- Preservar enums (Android serializa enums por nombre) -----
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# ----- Preservar Parcelables (si algún plugin los usa) -----
-keepclassmembers class * implements android.os.Parcelable {
    public static final ** CREATOR;
}

# ----- Preservar clases con @Keep -----
-keep @androidx.annotation.Keep class * { *; }
-keepclasseswithmembers class * {
    @androidx.annotation.Keep <methods>;
}
-keepclasseswithmembers class * {
    @androidx.annotation.Keep <fields>;
}
