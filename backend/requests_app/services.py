import hmac

from django.db import IntegrityError, transaction
from django.utils import timezone

from .models import AuditEvent, CounselingRequest, QueueCounter, UrgencyRequest
from .security import cpf_digest, encrypt_value


def create_request(*, full_name: str, cpf: str, classroom: str) -> CounselingRequest:
    digest = cpf_digest(cpf)
    with transaction.atomic():
        active_order = CounselingRequest.objects.filter(active_cpf_digest=digest).first()
        if active_order:
            raise ValueError('Você já possui uma solicitação ativa. Use o protocolo recebido para consultar o andamento.')
        counter = QueueCounter.objects.select_for_update().get(pk=1)
        counter.last_order += 1
        counter.save(update_fields=['last_order'])
        next_order = counter.last_order
        try:
            request = CounselingRequest.objects.create(
                full_name=full_name,
                cpf_ciphertext=encrypt_value(cpf),
                cpf_digest=digest,
                active_cpf_digest=digest,
                classroom=classroom,
                queue_order=next_order,
            )
        except IntegrityError as error:
            raise ValueError('Você já possui uma solicitação ativa. Use o protocolo recebido para consultar o andamento.') from error
        AuditEvent.objects.create(request=request, action='request_created', new_state={'status': request.status, 'queue_order': next_order})
        return request


def find_public_request(protocol: str, cpf: str):
    digest = cpf_digest(cpf)
    request = CounselingRequest.objects.filter(protocol=protocol).first()
    if request is None or not hmac.compare_digest(request.cpf_digest, digest):
        return None
    return request


def create_urgency(request: CounselingRequest, description: str) -> UrgencyRequest:
    urgency = UrgencyRequest.objects.create(request=request, description_ciphertext=encrypt_value(description))
    AuditEvent.objects.create(request=request, urgency=urgency, action='urgency_submitted', new_state={'evaluation': urgency.evaluation})
    return urgency


def reorder_request(request: CounselingRequest, position: int, actor, reason: str):
    with transaction.atomic():
        active = list(CounselingRequest.objects.select_for_update().filter(status__in=[
            CounselingRequest.Status.WAITING,
            CounselingRequest.Status.REVIEW,
            CounselingRequest.Status.IN_PROGRESS,
        ]).order_by('queue_order', 'received_at'))
        if request not in active or position > len(active):
            raise ValueError('A posição informada não está disponível na fila ativa.')
        previous = [item.pk for item in active]
        active.remove(request)
        active.insert(position - 1, request)
        for index, item in enumerate(active, start=1):
            item.queue_order = index
        CounselingRequest.objects.bulk_update(active, ['queue_order'])
        AuditEvent.objects.create(
            request=request,
            action='queue_reordered',
            previous_state={'order': previous},
            new_state={'order': [item.pk for item in active], 'queue_order': position},
            reason=reason,
            actor=actor,
        )


def update_request(request: CounselingRequest, data: dict, actor):
    previous = {'status': request.status, 'contact_status': request.contact_status, 'queue_order': request.queue_order}
    changed = []
    for field in ('status', 'contact_status', 'contact_note'):
        if field in data and getattr(request, field) != data[field]:
            setattr(request, field, data[field])
            changed.append(field)
    if 'status' in changed:
        if request.status in (CounselingRequest.Status.COMPLETED, CounselingRequest.Status.CANCELLED):
            request.active_cpf_digest = None
            request.completed_at = timezone.now() if request.status == CounselingRequest.Status.COMPLETED else None
        else:
            request.active_cpf_digest = request.cpf_digest
            request.completed_at = None
    if 'contact_status' in changed:
        request.contacted_at = timezone.now() if request.contact_status == CounselingRequest.ContactStatus.CONTACTED else None
    request.save()
    if changed:
        AuditEvent.objects.create(
            request=request,
            action='request_updated',
            previous_state=previous,
            new_state={'status': request.status, 'contact_status': request.contact_status, 'queue_order': request.queue_order},
            reason=data.get('reason', ''),
            actor=actor,
        )
    if 'queue_position' in data:
        reorder_request(request, data['queue_position'], actor, data.get('reason', ''))


def evaluate_urgency(urgency: UrgencyRequest, evaluation: str, reason: str, actor):
    previous = urgency.evaluation
    urgency.evaluation = evaluation
    urgency.reason = reason
    urgency.evaluated_at = timezone.now()
    urgency.evaluator = actor
    urgency.save(update_fields=['evaluation', 'reason', 'evaluated_at', 'evaluator'])
    AuditEvent.objects.create(
        request=urgency.request,
        urgency=urgency,
        action='urgency_evaluated',
        previous_state={'evaluation': previous},
        new_state={'evaluation': evaluation},
        reason=reason,
        actor=actor,
    )