from django.contrib import admin
from .models import ActivityLog, Device


@admin.register(Device)
class DeviceAdmin(admin.ModelAdmin):
    list_display = ("name", "location", "device_id", "cover", "manual", "last_seen")
    search_fields = ("name", "location", "device_id")
    readonly_fields = ("api_key", "last_seen", "created_at", "updated_at")


@admin.register(ActivityLog)
class ActivityLogAdmin(admin.ModelAdmin):
    list_display = ("device", "message", "created_at")
