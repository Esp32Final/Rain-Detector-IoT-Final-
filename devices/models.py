import secrets
from datetime import timedelta

from django.db import models
from django.utils import timezone


def new_api_key():
    return secrets.token_urlsafe(24)


class Device(models.Model):
    COVER_CHOICES = [("open", "Open"), ("closed", "Closed")]
    ONLINE_WINDOW = timedelta(seconds=20)     # device counts as online if seen this recently
    COMMAND_TTL = timedelta(minutes=5)        # a queued command expires after this

    # Set from the website
    name = models.CharField(max_length=60)
    location = models.CharField(max_length=60, blank=True)
    device_id = models.CharField(max_length=40, blank=True)
    notes = models.CharField(max_length=200, blank=True)
    api_key = models.CharField(max_length=64, unique=True, default=new_api_key, editable=False)

    # Reported by the ESP32
    rain = models.IntegerField(null=True, blank=True)
    light = models.IntegerField(null=True, blank=True)
    rain_th = models.IntegerField(default=2500)
    dark_th = models.IntegerField(default=800)
    wet_high = models.BooleanField(default=False)
    open_angle = models.IntegerField(default=0)
    closed_angle = models.IntegerField(default=110)
    cover = models.CharField(max_length=6, choices=COVER_CHOICES, default="open")
    manual = models.BooleanField(default=False)
    buzzing = models.BooleanField(default=False)
    manual_left = models.IntegerField(default=0)   # seconds until manual mode ends
    last_seen = models.DateTimeField(null=True, blank=True)

    # Website -> ESP32 (delivered on the ESP32's next check-in)
    pending_command = models.CharField(max_length=10, blank=True)  # open | closed | auto
    command_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    def log(self, message):
        """Add an activity entry and keep only the newest 50."""
        ActivityLog.objects.create(device=self, message=message[:160])
        keep = list(self.logs.values_list("pk", flat=True)[:50])
        self.logs.exclude(pk__in=keep).delete()

    @property
    def is_online(self):
        return bool(self.last_seen and timezone.now() - self.last_seen < self.ONLINE_WINDOW)

    def to_dict(self):
        return {
            "id": self.pk,
            "name": self.name,
            "location": self.location,
            "deviceId": self.device_id,
            "notes": self.notes,
            "apiKey": self.api_key,
            "rain": self.rain,
            "light": self.light,
            "rainTh": self.rain_th,
            "darkTh": self.dark_th,
            "wetHigh": self.wet_high,
            "openA": self.open_angle,
            "closedA": self.closed_angle,
            "cover": self.cover,
            "manual": self.manual,
            "buzzing": self.buzzing,
            "manualLeft": self.manual_left,
            "online": self.is_online,
            "seen": self.last_seen is not None,
            "lastSeen": self.last_seen.isoformat() if self.last_seen else None,
            "pending": self.pending_command,
        }


class ActivityLog(models.Model):
    device = models.ForeignKey(Device, related_name="logs", on_delete=models.CASCADE)
    message = models.CharField(max_length=160)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"{self.device.name}: {self.message}"
