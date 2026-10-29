from django.urls import path

from .views import (
    AdminDashboardView,
    AdminLoginView,
    AdminLogoutView,
    AdminRequestDetailView,
    AdminUrgencyDetailView,
    AdminUrgencyHistoryView,
    AdminUrgencyListView,
    RequestCreateView,
    RequestStatusView,
    UrgencyCreateView,
    csrf_token,
    health_check,
)

urlpatterns = [
    path('health/', health_check, name='health-check'),
    path('csrf/', csrf_token, name='csrf-token'),
    path('requests/', RequestCreateView.as_view(), name='request-create'),
    path('requests/status/', RequestStatusView.as_view(), name='request-status'),
    path('requests/urgency/', UrgencyCreateView.as_view(), name='urgency-create'),
    path('admin/login/', AdminLoginView.as_view(), name='admin-login'),
    path('admin/logout/', AdminLogoutView.as_view(), name='admin-logout'),
    path('admin/dashboard/', AdminDashboardView.as_view(), name='admin-dashboard'),
    path('admin/requests/<int:pk>/', AdminRequestDetailView.as_view(), name='admin-request-detail'),
    path('admin/urgencies/', AdminUrgencyListView.as_view(), name='admin-urgencies'),
    path('admin/urgencies/<int:pk>/', AdminUrgencyDetailView.as_view(), name='admin-urgency-detail'),
    path('admin/urgencies/<int:pk>/history/', AdminUrgencyHistoryView.as_view(), name='admin-urgency-history'),
]