# Rain Cover Control Center

| Layer           | Technology                          |
|-----------------|-------------------------------------|
| Frontend        | HTML, CSS, JavaScript               |
| Backend         | Python (Django)                     |
| Database        | SQLite                              |
| Hosting         | PythonAnywhere                      |
| Version control | Git, GitHub                         |
| Device          | ESP32 (Arduino C++)                 |

## How it works

The ESP32 can't be reached from the internet, so it calls the website instead:

```
Browser  <->  Django (PythonAnywhere + SQLite)  <->  ESP32
                                      every 5 s: ESP32 POSTs readings,
                                      Django replies with a waiting command
```

* The website stores devices in SQLite (no more browser localStorage).
* Each device gets its own **API key**; the ESP32 sends it as `X-API-Key`.
* Clicking **Close cover / Open cover** queues a command; the ESP32 picks it up
  within about 5 seconds. Commands older than 5 min are dropped.
* The website needs a login (Django user). Only the ESP32 endpoint uses the API key.

## 1. Run it on your computer first

```bash
python -m venv venv
venv\Scripts\activate          # Windows   (Mac/Linux: source venv/bin/activate)
pip install -r requirements.txt
python manage.py makemigrations devices
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver 0.0.0.0:8000
```

Open http://127.0.0.1:8000, log in, **Add device**, and copy its API key.

## 2. ESP32

1. Open `arduino/drying_rack/drying_rack.ino` in the Arduino IDE (or the Arduino Cloud Editor).
2. Install the **ESP32Servo** library, select your ESP32 board, upload, open Serial Monitor (115200).
3. `secrets.h` is **optional** (first-time defaults only). Copy `secrets.example.h` to `secrets.h` if you want it.
4. The device card on the website turns **Online** and shows live readings.

### Changing Wi-Fi or server later (no Arduino IDE, no computer)

The ESP32 stores its Wi-Fi, server URL and API key in its own memory.

* If it cannot join Wi-Fi at boot (new house), it starts a Wi-Fi network called **DryingRack-Setup**.
  Also: offline for 2 minutes, or hold the **BOOT** button for 3 seconds.
* Connect your phone to **DryingRack-Setup**. The setup page opens by itself (or go to `192.168.4.1`).
* Pick the Wi-Fi, type its password, set the server:
  * **PythonAnywhere:** type your username, press *Use PythonAnywhere*.
  * **Local computer:** type the PC's IP, press *Use local computer* (PC and ESP32 on the same Wi-Fi).
* Paste the device **API key** from the website you are using (the local site and the
  PythonAnywhere site have different keys). Leave blank to keep the saved one.
* Press **Save and restart**. The ESP32 reboots and joins the new Wi-Fi.

## 3. Put it on GitHub (no Git needed)

1. On github.com click **+ > New repository**, name it, create it.
2. Click **Add file > Upload files** and drag in the contents of this folder
   (up to 100 files per upload; repeat if needed).
3. Click **Commit changes**.
4. Check that `secrets.h`, `db.sqlite3` and the `venv` folder are **not** in the repo.

Never upload `arduino/drying_rack/secrets.h`: it holds your Wi-Fi password
and device API key. Use `secrets.example.h` as the template instead.
