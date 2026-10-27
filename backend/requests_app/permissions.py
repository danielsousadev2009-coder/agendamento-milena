from rest_framework.permissions import BasePermission


class IsPsychologist(BasePermission):
    message = 'Acesso restrito à psicóloga autorizada.'

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and hasattr(user, 'psychologist_profile') and user.psychologist_profile.active and user.is_active)