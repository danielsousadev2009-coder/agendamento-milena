from django.contrib.auth import authenticate, login, logout
from django.db.models import Count, Q
from django.http import JsonResponse
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from .models import AuditEvent, CounselingRequest, PsychologistAccount, UrgencyRequest
from .permissions import IsPsychologist
from .serializers import (
    PrivateIdentitySerializer,
    RequestCreateSerializer,
    RequestStatusSerializer,
    UrgencyCreateSerializer,
    UrgencyEvaluationSerializer,
)
from .services import create_request, create_urgency, evaluate_urgency, find_public_request, update_request
from .security import decrypt_value, mask_cpf
from .throttles import LoginRateThrottle, RequestCreateThrottle, UrgencyCreateThrottle


ACTIVE_STATUSES = [CounselingRequest.Status.WAITING, CounselingRequest.Status.REVIEW, CounselingRequest.Status.IN_PROGRESS]


@ensure_csrf_cookie
def csrf_token(request):
    return JsonResponse({'detail': 'CSRF cookie set.'})


class RequestCreateView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [RequestCreateThrottle]

    def post(self, request):
        serializer = RequestCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            order = create_request(**serializer.validated_data)
        except ValueError as error:
            return Response({'detail': str(error)}, status=status.HTTP_409_CONFLICT)
        return Response({'protocol': order.protocol, 'status': order.status}, status=status.HTTP_201_CREATED)


class RequestStatusView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [AnonRateThrottle]

    def post(self, request):
        serializer = PrivateIdentitySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        order = find_public_request(**serializer.validated_data)
        if order is None:
            return Response({'detail': 'Não encontramos uma solicitação com esses dados.'}, status=status.HTTP_404_NOT_FOUND)
        position = None
        if order.status in ACTIVE_STATUSES:
            position = CounselingRequest.objects.filter(status__in=ACTIVE_STATUSES, queue_order__lte=order.queue_order).count()
        return Response({'status': order.status, 'queue_position': position})


class UrgencyCreateView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [UrgencyCreateThrottle]

    def post(self, request):
        serializer = UrgencyCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        order = find_public_request(data['protocol'], data['cpf'])
        if order is None:
            return Response({'detail': 'Não foi possível vincular o pedido. Confira o protocolo e o CPF.'}, status=status.HTTP_404_NOT_FOUND)
        urgency = create_urgency(order, data['description'])
        return Response({'received': True, 'evaluation': urgency.evaluation}, status=status.HTTP_201_CREATED)


@method_decorator(csrf_protect, name='dispatch')
class AdminLoginView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [LoginRateThrottle]

    def post(self, request):
        username = str(request.data.get('username', ''))[:150]
        password = str(request.data.get('password', ''))
        user = authenticate(request, username=username, password=password)
        if not user or not user.is_active or not hasattr(user, 'psychologist_profile') or not user.psychologist_profile.active:
            return Response({'detail': 'Não foi possível entrar. Confira os dados ou tente mais tarde.'}, status=status.HTTP_400_BAD_REQUEST)
        login(request, user)
        PsychologistAccount.objects.filter(pk=user.psychologist_profile.pk).update(last_login_at=timezone.now())
        return Response({'authenticated': True})


class AdminLogoutView(APIView):
    permission_classes = [IsPsychologist]

    def post(self, request):
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AdminDashboardView(APIView):
    permission_classes = [IsPsychologist]

    def get(self, request):
        orders = list(CounselingRequest.objects.all().order_by('queue_order', 'received_at'))
        positions = {}
        position = 0
        for order in orders:
            if order.status in ACTIVE_STATUSES:
                position += 1
                positions[order.pk] = position
        query = request.query_params.get('q', '').strip()[:100]
        classroom = request.query_params.get('classroom', '').strip()[:80]
        status_filter = request.query_params.get('status', '').strip()
        if query:
            orders = [order for order in orders if query.casefold() in order.full_name.casefold() or query.casefold() in order.classroom.casefold()]
        if classroom:
            orders = [order for order in orders if classroom.casefold() in order.classroom.casefold()]
        if status_filter:
            orders = [order for order in orders if order.status == status_filter]
        counts = CounselingRequest.objects.values('status').annotate(total=Count('id'))
        return Response({
            'counts': {item['status']: item['total'] for item in counts},
            'pending_urgencies': UrgencyRequest.objects.filter(evaluation=UrgencyRequest.Evaluation.PENDING).count(),
            'requests': [{
                'id': order.pk,
                'full_name': order.full_name,
                'classroom': order.classroom,
                'cpf_masked': mask_cpf(decrypt_value(order.cpf_ciphertext)),
                'received_at': order.received_at,
                'protocol': order.protocol,
                'status': order.status,
                'queue_position': positions.get(order.pk),
                'contact_status': order.contact_status,
            } for order in orders],
        })


class AdminRequestDetailView(APIView):
    permission_classes = [IsPsychologist]

    def get_object(self, pk):
        try:
            return CounselingRequest.objects.get(pk=pk)
        except CounselingRequest.DoesNotExist:
            return None

    def get(self, request, pk):
        order = self.get_object(pk)
        if order is None:
            return Response({'detail': 'Solicitação não encontrada.'}, status=status.HTTP_404_NOT_FOUND)
        return Response({
            'id': order.pk, 'full_name': order.full_name, 'classroom': order.classroom,
            'cpf_masked': mask_cpf(decrypt_value(order.cpf_ciphertext)), 'protocol': order.protocol,
            'status': order.status, 'contact_status': order.contact_status,
            'contacted_at': order.contacted_at, 'contact_note': order.contact_note,
            'received_at': order.received_at,
            'history': list(order.audit_events.values('action', 'previous_state', 'new_state', 'reason', 'created_at')),
        })

    def patch(self, request, pk):
        order = self.get_object(pk)
        if order is None:
            return Response({'detail': 'Solicitação não encontrada.'}, status=status.HTTP_404_NOT_FOUND)
        serializer = RequestStatusSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if 'queue_position' in data and not data.get('reason', '').strip():
            return Response({'detail': 'Informe uma justificativa para alterar a ordem da fila.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            update_request(order, data, request.user)
        except ValueError as error:
            return Response({'detail': str(error)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({'updated': True})


class AdminUrgencyListView(APIView):
    permission_classes = [IsPsychologist]

    def get(self, request):
        urgencies = UrgencyRequest.objects.select_related('request').all()
        evaluation = request.query_params.get('evaluation', '')
        if evaluation:
            urgencies = urgencies.filter(evaluation=evaluation)
        return Response({'urgencies': [{
            'id': item.pk,
            'request_id': item.request_id,
            'student_name': item.request.full_name,
            'classroom': item.request.classroom,
            'protocol': item.request.protocol,
            'description': decrypt_value(item.description_ciphertext),
            'submitted_at': item.submitted_at,
            'evaluation': item.evaluation,
            'evaluated_at': item.evaluated_at,
            'reason': item.reason,
        } for item in urgencies]})


class AdminUrgencyDetailView(APIView):
    permission_classes = [IsPsychologist]

    def patch(self, request, pk):
        try:
            urgency = UrgencyRequest.objects.select_related('request').get(pk=pk)
        except UrgencyRequest.DoesNotExist:
            return Response({'detail': 'Solicitação de urgência não encontrada.'}, status=status.HTTP_404_NOT_FOUND)
        serializer = UrgencyEvaluationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        evaluate_urgency(urgency, data['evaluation'], data.get('reason', ''), request.user)
        return Response({'updated': True})


class AdminUrgencyHistoryView(APIView):
    permission_classes = [IsPsychologist]

    def get(self, request, pk):
        history = AuditEvent.objects.filter(urgency_id=pk).values('action', 'previous_state', 'new_state', 'reason', 'created_at')
        if not history.exists():
            return Response({'detail': 'Histórico não encontrado.'}, status=status.HTTP_404_NOT_FOUND)
        return Response({'history': list(history)})