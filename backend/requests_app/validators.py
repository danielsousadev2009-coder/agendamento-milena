import re

from django.core.exceptions import ValidationError


def normalize_cpf(value: str) -> str:
    return re.sub(r'\D', '', value or '')


def validate_cpf(value: str) -> str:
    digits = normalize_cpf(value)
    if len(digits) != 11 or len(set(digits)) == 1:
        raise ValidationError('Informe um CPF válido.')
    first = sum(int(digits[index]) * (10 - index) for index in range(9))
    first_digit = (first * 10) % 11
    if first_digit == 10:
        first_digit = 0
    second = sum(int(digits[index]) * (11 - index) for index in range(10))
    second_digit = (second * 10) % 11
    if second_digit == 10:
        second_digit = 0
    if digits[-2:] != f'{first_digit}{second_digit}':
        raise ValidationError('Informe um CPF válido.')
    return digits