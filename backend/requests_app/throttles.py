from rest_framework.throttling import ScopedRateThrottle


class LoginRateThrottle(ScopedRateThrottle):
    scope = 'login'


class RequestCreateThrottle(ScopedRateThrottle):
    scope = 'request_create'


class UrgencyCreateThrottle(ScopedRateThrottle):
    scope = 'urgency_create'