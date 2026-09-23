package com.securechat.app;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

  private static final String TAG = "AppUpdater";
  private static final String FILE_PROVIDER_AUTHORITY = "com.securechat.app.fileprovider";

  @PluginMethod
  public void getVersionCode(PluginCall call) {
    try {
      PackageInfo info = getContext().getPackageManager()
          .getPackageInfo(getContext().getPackageName(), 0);
      JSObject ret = new JSObject();
      ret.put("versionCode", info.versionCode);
      ret.put("versionName", info.versionName);
      call.resolve(ret);
    } catch (Exception e) {
      call.reject("Could not read app version", e);
    }
  }

  // Downloads the APK to the app's external files dir, then opens the system
  // package installer for it. The user confirms the update with one tap.
  @PluginMethod
  public void installUpdate(PluginCall call) {
    String url = call.getString("url");
    if (url == null || url.trim().isEmpty() || !url.startsWith("https://")) {
      call.reject("A valid https APK url is required.");
      return;
    }

    new Thread(() -> {
      try {
        File apk = downloadApk(url);
        if (apk == null) {
          new Handler(Looper.getMainLooper()).post(() -> call.reject("Download failed."));
          return;
        }
        new Handler(Looper.getMainLooper()).post(() -> {
          try {
            askToInstall(apk);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
          } catch (Exception e) {
            call.reject("Could not open installer: " + e.getMessage(), e);
          }
        });
      } catch (final Exception e) {
        new Handler(Looper.getMainLooper()).post(() -> call.reject("Download failed: " + e.getMessage(), e));
      }
    }).start();
  }

  private File downloadApk(String url) throws IOException {
    Context ctx = getContext();
    HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
    conn.setInstanceFollowRedirects(true);
    conn.setConnectTimeout(15000);
    conn.setReadTimeout(30000);
    conn.connect();

    int code = conn.getResponseCode();
    if (code >= 400) throw new IOException("HTTP " + code);

    File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
    if (dir == null) dir = ctx.getExternalFilesDir(null);
    if (dir == null) dir = ctx.getFilesDir();
    if (!dir.exists()) dir.mkdirs();

    File apk = new File(dir, "SecureChat-update.apk");
    try (InputStream in = conn.getInputStream();
         FileOutputStream out = new FileOutputStream(apk)) {
      byte[] buffer = new byte[8192];
      int read;
      while ((read = in.read(buffer)) != -1) {
        out.write(buffer, 0, read);
      }
    } finally {
      conn.disconnect();
    }
    Log.i(TAG, "Downloaded APK to " + apk.getAbsolutePath());
    return apk;
  }

  private void askToInstall(File apk) throws Exception {
    Uri apkUri = FileProvider.getUriForFile(getContext(), FILE_PROVIDER_AUTHORITY, apk);
    Intent intent = new Intent(Intent.ACTION_VIEW);
    intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
    getContext().startActivity(intent);
  }
}