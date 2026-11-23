/*
  Automatic Rain Cover (ESP32)
  ----------------------------
  Parts: ESP32, MG996R servo (hinge), rain sensor, LDR, buzzer

  Behavior:
    - Rain detected (or dark)  -> cover swings DOWN over the cover contents, buzzer 30 s
    - Dry and bright again     -> cover flips UP and opens,         buzzer 30 s
    - Servo moves slowly (smooth sweep) so the big panel doesn't slam
    - A new condition must hold 3 s before the cover moves
    - Buzzer is non-blocking, sensors keep running while it sounds

  Wiring:
    Water sensor  S -> D34, + -> D33, - -> GND
    LDR:  D32 -> LDR -> D35 -> 10k resistor -> GND   (D32 acts as the 3.3V supply)
    Servo signal -> GPIO26 (D26)
    Servo power  -> SEPARATE 5V supply (+), supply (-) tied to ESP32 GND
    Buzzer (+) -> GPIO25, (-) -> GND

  Website link (Django on PythonAnywhere):
    Every SYNC_EVERY_MS the ESP32 POSTs its readings to SERVER_URL and the
    server answers with a waiting command: "open", "closed" or "auto".
    open/closed -> manual mode for 10 min, auto -> back to automatic mode.
    The ESP32 only needs normal Wi-Fi with internet (no port forwarding).

  Changing Wi-Fi WITHOUT the Arduino IDE (setup mode):
  The Wi-Fi name, password, server URL and API key are saved inside the ESP32.
  If it cannot join Wi-Fi (for example at a new house), it starts its own network
  called "DryingRack-Setup". Connect your phone to it, the setup page opens
  (or go to 192.168.4.1), choose the new Wi-Fi, set the server, press Save.
  You can also hold the BOOT button for 3 s at any time to open setup mode.
  secrets.h is now OPTIONAL: it is only used as the first-time default.

Libraries needed: ESP32Servo (Arduino Library Manager). The rest is built in.
*/

#include <ESP32Servo.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WebServer.h>
#include <DNSServer.h>

// secrets.h is optional now. If it exists its values are the first-time defaults.
#if __has_include("secrets.h")
  #include "secrets.h"   // WIFI_SSID, WIFI_PASSWORD, SERVER_URL, API_KEY
#endif
#ifndef WIFI_SSID
  #define WIFI_SSID ""
#endif
#ifndef WIFI_PASSWORD
  #define WIFI_PASSWORD ""
#endif
#ifndef SERVER_URL
  #define SERVER_URL ""
#endif
#ifndef API_KEY
  #define API_KEY ""
#endif

// ---------- Setup mode (change Wi-Fi from your phone) ----------
const char* SETUP_AP_NAME = "DryingRack-Setup";   // open network, no password
const int   SETUP_BUTTON_PIN = 0;                 // BOOT button on most ESP32 boards
const unsigned long BUTTON_HOLD_MS         = 3000;    // hold BOOT 3 s to open setup
const unsigned long PORTAL_AFTER_OFFLINE_MS = 120000; // offline 2 min -> open setup
const unsigned long PORTAL_MAX_MS          = 600000;  // button-opened setup closes after 10 min

const unsigned long MANUAL_HOLD_MS = 600000;  // manual command holds 10 minutes
const unsigned long SYNC_EVERY_MS  = 5000;    // talk to the website every 5 s

// ---------- Pins ----------
const int RAIN_PIN   = 34;
const int LIGHT_PIN  = 35;  
const int SERVO_PIN  = 26;
const int BUZZER_PIN = 25;
const int LIGHT_POWER_PIN = 32;  // gives the LDR its 3.3V, so no 3V3 pin is needed

// ---------- Settings you can tune ----------
// Water sensor: reading goes UP when wet. (Rain module YL-83: goes DOWN when wet.)
const bool WET_IS_HIGH      = false;   // true = water sensor, false = rain module
const int  RAIN_THRESHOLD   = 2500;    // calibrate: a value between your dry and wet readings
// Powering the sensor only while reading stops its metal traces from corroding.
const bool POWER_SENSOR_FROM_PIN = true;  // true: sensor + wire goes to SENSOR_POWER_PIN
const int  SENSOR_POWER_PIN = 33;         // false: put + on 3V3 instead
const int  LIGHT_DARK_BELOW = 800;   // light reading BELOW this = dark
const int  LIGHT_BRIGHT_ABOVE = 1000; // once dark, it must rise ABOVE this to count as bright again
                                      // (the gap stops the cover flip-flopping near the threshold)
const bool CLOSE_WHEN_DARK  = true;  // protect items from night dew

// Swap these two numbers if your cover moves the wrong way
const int  CLOSED_ANGLE = 110;    // cover flat over the cover contents
const int  OPEN_ANGLE   = 0;  // cover flipped up

const unsigned long MOVE_STEP_MS     = 20;     // 1 degree every 20 ms (slower = gentler)
const unsigned long BUZZ_DURATION_MS = 30000;  // 30 seconds
const unsigned long BEEP_STEP_MS     = 500;
const unsigned long CONFIRM_MS       = 3000;
const unsigned long READ_EVERY_MS    = 500;
const int SAMPLES = 10;

enum CoverState { COVER_OPEN, COVER_CLOSED };

Servo cover;
CoverState state  = COVER_OPEN;
CoverState wanted = COVER_OPEN;
unsigned long wantedSince = 0;
unsigned long lastRead = 0;

int currentAngle = OPEN_ANGLE;
int targetAngle  = OPEN_ANGLE;
unsigned long lastStep = 0;

// Why the cover last moved: "rain", "dark", "clear" or "manual". Sent to the website
// so the activity log shows the reason the ESP32 really acted on.
String moveReason = "clear";
String wantedReason = "clear";
bool darkLatched = false;

bool buzzing = false;
bool buzzerLevel = false;
unsigned long buzzStart = 0;
unsigned long lastBeep = 0;

int rainRaw = 0, lightRaw = 0;
bool manual = false;
unsigned long manualUntil = 0;
unsigned long lastWifiTry = 0;
unsigned long lastSync = 0;

// Saved settings (stored in the ESP32's own memory)
Preferences prefs;
WebServer web(80);
DNSServer dns;
String cfgSsid, cfgPass, cfgUrl, cfgKey;
bool portalOn = false, portalManual = false;
unsigned long portalStart = 0, offlineSince = 0, btnDownSince = 0;
String scanOptions;

void loadConfig() {
  prefs.begin("rack", false);
  cfgSsid = prefs.getString("ssid", WIFI_SSID);
  cfgPass = prefs.getString("pass", WIFI_PASSWORD);
  cfgUrl  = prefs.getString("url",  SERVER_URL);
  cfgKey  = prefs.getString("key",  API_KEY);
  prefs.end();
}

void saveConfig() {
  prefs.begin("rack", false);
  prefs.putString("ssid", cfgSsid);
  prefs.putString("pass", cfgPass);
  prefs.putString("url",  cfgUrl);
  prefs.putString("key",  cfgKey);
  prefs.end();
}

String esc(String t) {
  t.replace("&", "&amp;"); t.replace("<", "&lt;"); t.replace(">", "&gt;"); t.replace("\"", "&quot;");
  return t;
}

String pageHead() {
  return F("<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Drying Rack Setup</title><style>body{font-family:system-ui,sans-serif;background:#0b1a24;color:#e8f1f2;margin:0;padding:16px}main{max-width:460px;margin:0 auto}h1{font-size:1.3rem}label{display:block;margin:12px 0 4px;font-size:.85rem;color:#9fb4bd}input{width:100%;box-sizing:border-box;padding:11px;border-radius:10px;border:1px solid #2a4452;background:#0f2431;color:#e8f1f2;font-size:1rem}button{margin-top:16px;width:100%;padding:13px;border:0;border-radius:10px;background:#2dd4bf;color:#05211d;font-weight:700;font-size:1rem}button.s{background:#1b3646;color:#e8f1f2;margin-top:6px;padding:9px;font-size:.85rem}.card{background:#0f2431;border:1px solid #2a4452;border-radius:12px;padding:12px;margin-top:14px}small{color:#9fb4bd}</style></head><body><main>");
}

String pageHtml() {
  String h = pageHead();
  h += "<h1>Drying Rack Setup</h1><small>Status: ";
  if (WiFi.status() == WL_CONNECTED) h += "connected to " + esc(WiFi.SSID());
  else h += "not connected to Wi-Fi";
  h += "</small><form method=post action=/save>";
  h += "<label>Wi-Fi name</label><input name=ssid list=nets value=\"" + esc(cfgSsid) + "\" required autocapitalize=off autocorrect=off>";
  h += "<datalist id=nets>" + scanOptions + "</datalist>";
  h += "<label>Wi-Fi password</label><input name=pass type=password placeholder=\"" + String(cfgPass.length() ? "leave blank to keep the saved one" : "Wi-Fi password") + "\">";
  h += "<div class=card><b>Server</b>";
  h += "<label>PythonAnywhere username</label><input id=pa placeholder=yourname>";
  h += "<button type=button class=s onclick=\"document.getElementById('u').value='https://'+document.getElementById('pa').value.trim()+'.pythonanywhere.com/api/esp/sync/'\">Use PythonAnywhere</button>";
  h += "<label>Computer IP (local test)</label><input id=ip placeholder=192.168.1.50>";
  h += "<button type=button class=s onclick=\"document.getElementById('u').value='http://'+document.getElementById('ip').value.trim()+':8000/api/esp/sync/'\">Use local computer</button>";
  h += "<label>Server URL</label><input id=u name=url value=\"" + esc(cfgUrl) + "\" required autocapitalize=off autocorrect=off></div>";
  h += "<label>Device API key</label><input name=key autocapitalize=off autocorrect=off placeholder=\"" + String(cfgKey.length() ? "leave blank to keep the saved one" : "paste the key from the website") + "\">";
  h += "<button>Save and restart</button></form>";
  h += "<p><small>If this page does not open by itself, go to 192.168.4.1</small></p></main></body></html>";
  return h;
}

String messagePage(const String& text) {
  return pageHead() + "<h1>Drying Rack Setup</h1><p>" + text + "</p></main></body></html>";
}

void handleRoot() { web.send(200, "text/html", pageHtml()); }

void handleSave() {
  String s = web.arg("ssid"), p = web.arg("pass"), u = web.arg("url"), k = web.arg("key");
  s.trim(); u.trim(); k.trim();
  if (!s.length() || !u.startsWith("http")) {
    web.send(400, "text/html", messagePage("Please enter the Wi-Fi name and a server URL that starts with http:// or https://. Go back and try again."));
    return;
  }
  if (s != cfgSsid) cfgPass = p;          // new network: use the typed password (blank = open network)
  else if (p.length()) cfgPass = p;       // same network: blank keeps the saved password
  cfgSsid = s; cfgUrl = u;
  if (k.length()) cfgKey = k;             // blank keeps the saved key
  saveConfig();
  web.send(200, "text/html", messagePage("Saved. The ESP32 is restarting and will join <b>" + esc(s) + "</b>. You can reconnect your phone to normal Wi-Fi now."));
  delay(1500);
  ESP.restart();
}

void handleNotFound() {   // makes phones open the setup page automatically
  web.sendHeader("Location", String("http://") + WiFi.softAPIP().toString() + "/");
  web.send(302, "text/plain", "");
}

void startPortal(bool manual) {
  if (portalOn) return;
  Serial.println("Setup mode: looking for nearby Wi-Fi networks...");
  WiFi.mode(WIFI_AP_STA);
  int n = WiFi.scanNetworks();
  scanOptions = "";
  String seen = "|";
  for (int i = 0; i < n && i < 20; i++) {
    String name = WiFi.SSID(i);
    if (!name.length() || seen.indexOf("|" + name + "|") >= 0) continue;
    seen += name + "|";
    scanOptions += "<option value=\"" + esc(name) + "\">";
  }
  WiFi.scanDelete();
  WiFi.softAP(SETUP_AP_NAME);
  dns.start(53, "*", WiFi.softAPIP());
  web.begin();
  portalOn = true; portalManual = manual; portalStart = millis();
  Serial.print("Setup mode ON. Connect your phone to Wi-Fi \"");
  Serial.print(SETUP_AP_NAME);
  Serial.print("\" then open http://");
  Serial.println(WiFi.softAPIP());
}

void stopPortal() {
  web.stop();
  dns.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  portalOn = false;
  Serial.println("Setup mode OFF.");
}

void updatePortal(unsigned long now) {
  // Hold BOOT for 3 s to open setup mode
  if (digitalRead(SETUP_BUTTON_PIN) == LOW) {
    if (!btnDownSince) btnDownSince = now;
    else if (now - btnDownSince >= BUTTON_HOLD_MS && !portalOn) startPortal(true);
  } else {
    btnDownSince = 0;
  }
  // Offline for 2 minutes -> open setup mode automatically
  if (WiFi.status() == WL_CONNECTED) offlineSince = 0;
  else if (!offlineSince) offlineSince = now;
  else if (!portalOn && now - offlineSince >= PORTAL_AFTER_OFFLINE_MS) startPortal(false);

  if (portalOn) {
    dns.processNextRequest();
    web.handleClient();
    if (!portalManual && WiFi.status() == WL_CONNECTED) stopPortal();
    else if (portalManual && now - portalStart >= PORTAL_MAX_MS) stopPortal();
  }
}

int readAveraged(int pin) {
  long sum = 0;
  for (int i = 0; i < SAMPLES; i++) {
    sum += analogRead(pin);
    delay(3);
  } 
  return sum / SAMPLES;
}

int readRain() {
  if (POWER_SENSOR_FROM_PIN) {
    digitalWrite(SENSOR_POWER_PIN, HIGH);
    delay(20);
  }
  int v = readAveraged(RAIN_PIN);
  if (POWER_SENSOR_FROM_PIN) digitalWrite(SENSOR_POWER_PIN, LOW);
  return v;
}

void startBuzzer() {
  buzzing = true;
  buzzStart = millis();
  lastBeep = 0;
  buzzerLevel = false;
}

void updateBuzzer() {
  if (!buzzing) return;
  unsigned long now = millis();
  if (now - buzzStart >= BUZZ_DURATION_MS) {
    buzzing = false;
    digitalWrite(BUZZER_PIN, LOW);
    return;
  }
  if (now - lastBeep >= BEEP_STEP_MS) {
    lastBeep = now;
    buzzerLevel = !buzzerLevel;
    digitalWrite(BUZZER_PIN, buzzerLevel ? HIGH : LOW);
  }
}

// Moves the servo 1 degree at a time toward targetAngle
void updateServo() {
  if (currentAngle == targetAngle) return;
  unsigned long now = millis();
  if (now - lastStep < MOVE_STEP_MS) return;
  lastStep = now;
  currentAngle += (targetAngle > currentAngle) ? 1 : -1;
  cover.write(currentAngle);
}

void moveCover(CoverState target, bool withBuzzer, const char* reason) {
  state = target;
  moveReason = reason;
  targetAngle = (target == COVER_CLOSED) ? CLOSED_ANGLE : OPEN_ANGLE;
  Serial.println(target == COVER_CLOSED ? ">> CLOSING cover" : ">> OPENING cover");
  if (withBuzzer) startBuzzer();
}

String buildStatusJson() {
  String j = "{";
  j += "\"rain\":" + String(rainRaw) + ",\"light\":" + String(lightRaw) + ",";
  j += "\"cover\":\"" + String(state == COVER_CLOSED ? "closed" : "open") + "\",";
  long left = manual ? (long)(manualUntil - millis()) / 1000 : 0;
  if (left < 0) left = 0;
  j += "\"reason\":\"" + moveReason + "\",";
  j += "\"manual\":" + String(manual ? "true" : "false") + ",\"manualLeft\":" + String(left) + ",";
  j += "\"buzzing\":" + String(buzzing ? "true" : "false") + ",";
  j += "\"rainTh\":" + String(RAIN_THRESHOLD) + ",\"wetHigh\":" + String(WET_IS_HIGH ? "true" : "false") + ",\"darkTh\":" + String(LIGHT_DARK_BELOW) + ",";
  j += "\"openA\":" + String(OPEN_ANGLE) + ",\"closedA\":" + String(CLOSED_ANGLE) + "}";
  return j;
}

// A command that came back from the website
void applyCommand(const String& resp) {
  if (resp.indexOf("\"auto\"") >= 0) {
    manual = false;
    Serial.println(">> Website: back to AUTO mode");
  } else if (resp.indexOf("\"closed\"") >= 0 || resp.indexOf("\"open\"") >= 0) {
    CoverState t = (resp.indexOf("\"closed\"") >= 0) ? COVER_CLOSED : COVER_OPEN;
    manual = true;
    manualUntil = millis() + MANUAL_HOLD_MS;
    Serial.println(">> Website: manual command");
    if (t != state) moveCover(t, true, "manual");
  }
}

// Send readings, receive command. Works with https:// (PythonAnywhere) or http:// (local test).
void syncWithServer() {
  if (WiFi.status() != WL_CONNECTED || !cfgUrl.length()) return;
  String url = cfgUrl;
  Serial.println(url);
  WiFiClientSecure secureClient;
  WiFiClient plainClient;
  HTTPClient http;
  bool ok;  
  if (url.startsWith("https")) {
    secureClient.setInsecure();   // skips certificate check; fine for a hobby project
    ok = http.begin(secureClient, url);
  } else {
    ok = http.begin(plainClient, url);
  }
  if (!ok) return;
  http.setTimeout(5000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", cfgKey);
  int code = http.POST(buildStatusJson());
  if (code == 200) {
    applyCommand(http.getString());
  } else {
    Serial.printf("Sync failed (HTTP %d: %s)\n", code, http.errorToString(code).c_str());
  }
  http.end();
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  if (!cfgSsid.length()) {
    Serial.println("No Wi-Fi saved yet.");
    return;
  }
  WiFi.begin(cfgSsid.c_str(), cfgPass.c_str());
  Serial.print("Connecting to Wi-Fi");
  unsigned long t = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t < 15000) {
    delay(500);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("\nConnected. Device IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nWi-Fi failed. The cover still works automatically (website offline).");
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  analogReadResolution(12);
  pinMode(SENSOR_POWER_PIN, OUTPUT);
  digitalWrite(SENSOR_POWER_PIN, LOW);
  pinMode(LIGHT_POWER_PIN, OUTPUT);
  digitalWrite(LIGHT_POWER_PIN, HIGH);  // 3.3V supply for the LDR
  analogSetPinAttenuation(RAIN_PIN, ADC_11db);
  analogSetPinAttenuation(LIGHT_PIN, ADC_11db);

  cover.setPeriodHertz(50);
  cover.attach(SERVO_PIN, 500, 2400);
  cover.write(OPEN_ANGLE);   // start open, no buzzer
  pinMode(SETUP_BUTTON_PIN, INPUT_PULLUP);
  loadConfig();
  web.on("/", HTTP_GET, handleRoot);
  web.on("/save", HTTP_POST, handleSave);
  web.onNotFound(handleNotFound);
  connectWifi();
  if (WiFi.status() != WL_CONNECTED) startPortal(false);   // can't join Wi-Fi: open setup mode
  Serial.println("Drying rack ready.");
}

void loop() {
  unsigned long now = millis();
  updateBuzzer();
  updateServo();
  updatePortal(now);
  if (cfgSsid.length() && WiFi.status() != WL_CONNECTED && now - lastWifiTry > 30000) {
    lastWifiTry = now;
    WiFi.reconnect();
  }

  // Sync with the website, but not while the servo is mid-move (HTTPS takes ~1 s)
  if (currentAngle == targetAngle && now - lastSync >= SYNC_EVERY_MS) {
    lastSync = now;
    syncWithServer();
  }

  if (now - lastRead < READ_EVERY_MS) return;
  lastRead = now;

  rainRaw  = readRain();
  lightRaw = readAveraged(LIGHT_PIN);
  bool raining = WET_IS_HIGH ? (rainRaw > RAIN_THRESHOLD) : (rainRaw < RAIN_THRESHOLD);
  // Light with hysteresis: dark below 800, bright again only above 1000
  if (darkLatched) darkLatched = lightRaw < LIGHT_BRIGHT_ABOVE;
  else             darkLatched = lightRaw < LIGHT_DARK_BELOW;
  bool dark = darkLatched;

  CoverState target = (raining || (CLOSE_WHEN_DARK && dark)) ? COVER_CLOSED : COVER_OPEN;
  const char* why = raining ? "rain" : ((CLOSE_WHEN_DARK && dark) ? "dark" : "clear");

  if (target != wanted) {
    wanted = target;
    wantedSince = now;
  }
  wantedReason = why;   // keeps the reason from the moment the cover actually moves
  if (manual && (long)(manualUntil - now) <= 0) manual = false;  // manual hold ended
  if (!manual && wanted != state && now - wantedSince >= CONFIRM_MS) {
    moveCover(wanted, true, wantedReason.c_str());
  }

  Serial.printf("Rain:%4d %s | Light:%4d %s | Cover:%s (%d deg)%s\n",
                rainRaw, raining ? "WET" : "dry",
                lightRaw, dark ? "DARK" : "bright",
                state == COVER_CLOSED ? "CLOSED" : "OPEN", currentAngle,
                buzzing ? " | BUZZING" : "");
}
