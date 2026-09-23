package com.securechat.app;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import java.util.List;

public class MainActivity extends BridgeActivity {
  @Override
  public void registerPlugins(List<Class<? extends Plugin>> plugins) {
    plugins.add(AppUpdaterPlugin.class);
    super.registerPlugins(plugins);
  }
}