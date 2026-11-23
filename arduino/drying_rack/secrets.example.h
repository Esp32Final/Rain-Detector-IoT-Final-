// OPTIONAL. You can skip this file and enter everything from your phone instead:
// the ESP32 opens a "DryingRack-Setup" Wi-Fi when it cannot connect (see README).
// If you do want first-time defaults, copy this file to "secrets.h" (same folder).
// secrets.h is in .gitignore so your Wi-Fi password never reaches GitHub.
#pragma once

#define WIFI_SSID      "YOUR_WIFI_NAME"       // must be a 2.4 GHz network
#define WIFI_PASSWORD  "YOUR_WIFI_PASSWORD"

// Your PythonAnywhere site (https), or http://<your-pc-ip>:8000 when testing locally
#define SERVER_URL     "https://YOURUSERNAME.pythonanywhere.com/api/esp/sync/"

// Copy the key shown in the website: Edit device -> Device API key
#define API_KEY        "PASTE_YOUR_DEVICE_API_KEY_HERE"
