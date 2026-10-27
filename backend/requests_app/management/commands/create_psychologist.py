from getpass import getpass

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.management.base import BaseCommand, CommandError
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from requests_app.models import PsychologistAccount


class Command(BaseCommand):
    help = 'Cria a conta administrativa única da psicóloga de forma interativa.'

    def handle(self, *args, **options):
        user_model = get_user_model()
        if PsychologistAccount.objects.filter(active=True).exists():
            raise CommandError('Já existe uma conta administrativa ativa.')
        username = input('Usuário ou e-mail: ').strip()
        if not username:
            raise CommandError('O usuário não pode ficar vazio.')
        password = getpass('Senha (não será exibida): ')
        repeated = getpass('Repita a senha: ')
        if password != repeated:
            raise CommandError('As senhas não coincidem.')
        user = user_model(username=username, email=username if '@' in username else '')
        try:
            validate_password(password, user)
        except ValidationError as error:
            raise CommandError('; '.join(error.messages)) from error
        try:
            with transaction.atomic():
                user.set_password(password)
                user.is_staff = False
                user.is_superuser = False
                user.save()
                PsychologistAccount.objects.create(user=user, active=True)
        except IntegrityError as error:
            raise CommandError('A conta única já foi criada. Verifique o estado no banco.') from error
        self.stdout.write(self.style.SUCCESS('Conta administrativa criada. Guarde as credenciais em local seguro.'))