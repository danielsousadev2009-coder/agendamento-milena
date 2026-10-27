import secrets

from django.conf import settings
from django.db import models
from django.utils import timezone


def generate_protocol():
    return f'AC-{secrets.token_urlsafe(16)}'


class CounselingRequest(models.Model):
    class Status(models.TextChoices):
        WAITING = 'waiting', 'Aguardando'
        REVIEW = 'review', 'Em análise'
        IN_PROGRESS = 'in_progress', 'Em atendimento'
        COMPLETED = 'completed', 'Concluído'
        CANCELLED = 'cancelled', 'Cancelado'

    class ContactStatus(models.TextChoices):
        NOT_STARTED = 'not_started', 'Não iniciado'
        CONTACTED = 'contacted', 'Contato realizado'
        AWAITING_RESPONSE = 'awaiting_response', 'Aguardando resposta'

    full_name = models.CharField(max_length=160)
    cpf_ciphertext = models.TextField()
    cpf_digest = models.CharField(max_length=64, db_index=True)
    active_cpf_digest = models.CharField(max_length=64, null=True, blank=True, unique=True)
    classroom = models.CharField(max_length=80)
    protocol = models.CharField(max_length=40, unique=True, default=generate_protocol)
    received_at = models.DateTimeField(default=timezone.now, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.WAITING, db_index=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    queue_order = models.PositiveIntegerField(db_index=True)
    contact_status = models.CharField(max_length=24, choices=ContactStatus.choices, default=ContactStatus.NOT_STARTED)
    contacted_at = models.DateTimeField(null=True, blank=True)
    contact_note = models.CharField(max_length=500, blank=True)

    class Meta:
        ordering = ['queue_order', 'received_at']
        indexes = [models.Index(fields=['status', 'queue_order'])]

    def __str__(self):
        return f'{self.protocol} ({self.status})'


class QueueCounter(models.Model):
    last_order = models.PositiveIntegerField(default=0)


class PsychologistAccount(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='psychologist_profile')
    active = models.BooleanField(default=True)
    slot = models.PositiveSmallIntegerField(default=1, unique=True, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    last_login_at = models.DateTimeField(null=True, blank=True)

    def save(self, *args, **kwargs):
        self.slot = 1
        super().save(*args, **kwargs)


class UrgencyRequest(models.Model):
    class Evaluation(models.TextChoices):
        PENDING = 'pending', 'Aguardando avaliação'
        CONFIRMED = 'confirmed', 'Urgência confirmada'
        NOT_URGENT = 'not_urgent', 'Não classificada como urgência'
        MORE_INFO = 'more_info', 'Precisa de mais informações'

    request = models.ForeignKey(CounselingRequest, on_delete=models.CASCADE, related_name='urgencies')
    description_ciphertext = models.TextField()
    submitted_at = models.DateTimeField(default=timezone.now, db_index=True)
    evaluation = models.CharField(max_length=16, choices=Evaluation.choices, default=Evaluation.PENDING, db_index=True)
    evaluated_at = models.DateTimeField(null=True, blank=True)
    reason = models.CharField(max_length=500, blank=True)
    evaluator = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)

    class Meta:
        ordering = ['evaluation', 'submitted_at']


class AuditEvent(models.Model):
    request = models.ForeignKey(CounselingRequest, null=True, blank=True, on_delete=models.SET_NULL, related_name='audit_events')
    urgency = models.ForeignKey(UrgencyRequest, null=True, blank=True, on_delete=models.SET_NULL, related_name='audit_events')
    action = models.CharField(max_length=40)
    previous_state = models.JSONField(default=dict, blank=True)
    new_state = models.JSONField(default=dict, blank=True)
    reason = models.CharField(max_length=500, blank=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at']