from rest_framework import serializers

from .validators import validate_cpf


class RequestCreateSerializer(serializers.Serializer):
    full_name = serializers.CharField(max_length=160, trim_whitespace=True)
    cpf = serializers.CharField(max_length=20, write_only=True)
    classroom = serializers.CharField(max_length=80, trim_whitespace=True)

    def validate_full_name(self, value):
        normalized = ' '.join(value.split())
        if len(normalized.split()) < 2:
            raise serializers.ValidationError('Informe seu nome completo.')
        return normalized

    def validate_cpf(self, value):
        try:
            return validate_cpf(value)
        except Exception as error:
            raise serializers.ValidationError('Informe um CPF válido.') from error

    def validate_classroom(self, value):
        normalized = ' '.join(value.split())
        if not normalized:
            raise serializers.ValidationError('Informe sua turma.')
        return normalized


class PrivateIdentitySerializer(serializers.Serializer):
    protocol = serializers.CharField(max_length=40)
    cpf = serializers.CharField(max_length=20, write_only=True)

    def validate_cpf(self, value):
        try:
            return validate_cpf(value)
        except Exception as error:
            raise serializers.ValidationError('Informe um CPF válido.') from error


class PublicStatusLookupSerializer(PrivateIdentitySerializer):
    pass


class UrgencyCreateSerializer(PrivateIdentitySerializer):
    description = serializers.CharField(min_length=10, max_length=2000, trim_whitespace=True, write_only=True)


class RequestStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=['waiting', 'review', 'in_progress', 'completed', 'cancelled'], required=False)
    contact_status = serializers.ChoiceField(choices=['not_started', 'contacted', 'awaiting_response'], required=False)
    contact_note = serializers.CharField(max_length=500, required=False, allow_blank=True)
    queue_position = serializers.IntegerField(min_value=1, required=False)
    reason = serializers.CharField(max_length=500, required=False, allow_blank=True)


class UrgencyEvaluationSerializer(serializers.Serializer):
    evaluation = serializers.ChoiceField(choices=['confirmed', 'not_urgent', 'more_info'])
    reason = serializers.CharField(max_length=500, required=False, allow_blank=True)