from django.urls import path
from . import views

urlpatterns = [
    path("", views.index, name="index"),
    path("api/devices/", views.devices_collection, name="devices"),
    path("api/devices/<int:pk>/", views.device_detail, name="device_detail"),
    path("api/devices/<int:pk>/command/", views.device_command, name="device_command"),
    path("api/devices/<int:pk>/key/", views.device_new_key, name="device_new_key"),
    path("api/activity/", views.activity_all, name="activity_all"),
    path("api/devices/<int:pk>/log/", views.device_log, name="device_log"),
    path("api/esp/sync/", views.esp_sync, name="esp_sync"),
]
