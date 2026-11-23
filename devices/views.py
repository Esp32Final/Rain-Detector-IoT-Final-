import json
from functools import wraps

from django.http import JsonResponse
from django.shortcuts import get_object_or_404, render
from django.utils import timezone
from django.contrib.auth.decorators import login_required
from django.views.decorators.csrf import csrf_exempt, ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from .models import ActivityLog, Device, new_api_key


# ---------- helpers ----------

def api_login_required(view):
    """Like login_required, but answers JSON 401 instead of redirecting."""
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({"error": "login required"}, status=401)
        return view(request, *args, **kwargs)
    return wrapper


def read_json(request):
    try:
        data = json.loads(request.body or b"{}")
        return data if isinstance(data, dict) else None
    except (ValueError, UnicodeDecodeError):
        return None


def clamp(value, lo, hi, default):
    try:
        v = int(value)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


def text(data, key, limit):
    return str(data.get(key) or "").strip()[:limit]


REASONS = {
    "rain": "Rain detected.",
    "dark": "It is dark.",
    "clear": "Dry and bright.",
    "manual": "Manual command.",
}


def why(d, reported=None):
    """Plain-words reason for the cover's move (for the activity log).

    The ESP32 reports the reason it actually acted on. Re-deriving it from the
    sensor values at sync time was wrong: the readings change while the servo
    is still moving, so the log said things like "Cover opened. It is dark."
    The sensor-based guess below is only a fallback for old firmware.
    """
    if reported in REASONS:
        return REASONS[reported]
    if d.manual:
        return "Manual command."
    if d.rain is not None and (d.rain > d.rain_th if d.wet_high else d.rain < d.rain_th):
        return "Rain detected."
    if d.light is not None and d.light < d.dark_th:
        return "It is dark."
    return "Dry and bright."


# ---------- website pages ----------

@login_required
@ensure_csrf_cookie
def index(request):
    return render(request, "index.html")


# ---------- API used by the website (needs login) ----------

@api_login_required
@require_http_methods(["GET", "POST"])
def devices_collection(request):
    if request.method == "GET":
        return JsonResponse({"devices": [d.to_dict() for d in Device.objects.all()]})

    data = read_json(request)
    if data is None:
        return JsonResponse({"error": "invalid JSON"}, status=400)
    name = text(data, "name", 60)
    if not name:
        return JsonResponse({"error": "Please enter a device name."}, status=400)
    device = Device.objects.create(
        name=name,
        location=text(data, "location", 60),
        device_id=text(data, "deviceId", 40),
        notes=text(data, "notes", 200),
    )
    device.log("Device added. Waiting for it to connect.")
    return JsonResponse(device.to_dict(), status=201)


@api_login_required
@require_http_methods(["PUT", "PATCH", "DELETE"])
def device_detail(request, pk):
    device = get_object_or_404(Device, pk=pk)

    if request.method == "DELETE":
        device.delete()
        return JsonResponse({"deleted": True})

    data = read_json(request)
    if data is None:
        return JsonResponse({"error": "invalid JSON"}, status=400)
    name = text(data, "name", 60)
    if not name:
        return JsonResponse({"error": "Please enter a device name."}, status=400)
    device.name = name
    device.location = text(data, "location", 60)
    device.device_id = text(data, "deviceId", 40)
    device.notes = text(data, "notes", 200)
    device.save()
    return JsonResponse(device.to_dict())


@api_login_required
@require_POST
def device_command(request, pk):
    """Website asks the cover to open / close / go back to auto."""
    device = get_object_or_404(Device, pk=pk)
    data = read_json(request)
    cmd = (data or {}).get("command")
    if cmd not in ("open", "closed", "auto"):
        return JsonResponse({"error": "command must be open, closed or auto"}, status=400)
    device.pending_command = cmd
    device.command_at = timezone.now()
    device.save(update_fields=["pending_command", "command_at", "updated_at"])
    device.log({"open": "Open cover requested from the website.",
                "closed": "Close cover requested from the website.",
                "auto": "Auto mode requested from the website."}[cmd])
    return JsonResponse(device.to_dict())


@api_login_required
@require_GET
def device_log(request, pk):
    device = get_object_or_404(Device, pk=pk)
    items = [{"time": e.created_at.isoformat(), "message": e.message} for e in device.logs.all()[:20]]
    return JsonResponse({"log": items})


@api_login_required
@require_POST
def device_new_key(request, pk):
    """Replace the device's API key. The old key stops working immediately."""
    device = get_object_or_404(Device, pk=pk)
    device.api_key = new_api_key()
    device.save(update_fields=["api_key", "updated_at"])
    device.log("API key changed. Update the key in the ESP32 code.")
    return JsonResponse(device.to_dict())


@api_login_required
@require_GET
def activity_all(request):
    """Newest activity from every device (Recent Activity page)."""
    rows = ActivityLog.objects.select_related("device")[:60]
    return JsonResponse({"log": [
        {"time": e.created_at.isoformat(), "message": e.message,
         "deviceId": e.device_id, "device": e.device.name} for e in rows
    ]})


# ---------- API used by the ESP32 (needs its API key, not a login) ----------

@csrf_exempt
@require_POST
def esp_sync(request):
    """ESP32 posts its readings and gets back any command waiting for it."""
    key = request.headers.get("X-API-Key", "")
    device = Device.objects.filter(api_key=key).first() if key else None
    if device is None:
        return JsonResponse({"error": "bad api key"}, status=401)

    data = read_json(request)
    if data is None:
        return JsonResponse({"error": "invalid JSON"}, status=400)

    old_cover, old_manual, old_seen, was_online = device.cover, device.manual, device.last_seen, device.is_online

    device.rain = clamp(data.get("rain"), 0, 4095, device.rain)
    device.light = clamp(data.get("light"), 0, 4095, device.light)
    device.rain_th = clamp(data.get("rainTh"), 0, 4095, device.rain_th)
    device.dark_th = clamp(data.get("darkTh"), 0, 4095, device.dark_th)
    device.open_angle = clamp(data.get("openA"), 0, 180, device.open_angle)
    device.closed_angle = clamp(data.get("closedA"), 0, 180, device.closed_angle)
    device.wet_high = bool(data.get("wetHigh", device.wet_high))
    device.manual = bool(data.get("manual", device.manual))
    device.manual_left = clamp(data.get("manualLeft"), 0, 3600, 0) if device.manual else 0
    device.buzzing = bool(data.get("buzzing", device.buzzing))
    if data.get("cover") in ("open", "closed"):
        device.cover = data["cover"]
    device.last_seen = timezone.now()
    device.save(update_fields=[
        "rain", "light", "rain_th", "dark_th", "open_angle", "closed_angle",
        "wet_high", "manual", "manual_left", "buzzing", "cover", "last_seen", "updated_at",
    ])

    if old_seen is None:
        device.log("Device connected for the first time.")
    elif not was_online:
        device.log("Device is back online.")
    if old_seen is not None and device.cover != old_cover:
        device.log(("Cover closed. " if device.cover == "closed" else "Cover opened. ") + why(device, data.get("reason")))
    if old_manual and not device.manual:
        device.log("Back to auto mode.")

    # Hand over a waiting command once (ignore ones that went stale while offline).
    cmd = device.pending_command
    fresh = device.command_at and timezone.now() - device.command_at < Device.COMMAND_TTL
    if cmd:
        Device.objects.filter(pk=device.pk, pending_command=cmd).update(pending_command="")
    return JsonResponse({"command": cmd if (cmd and fresh) else None})
