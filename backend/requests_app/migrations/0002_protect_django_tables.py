from django.db import migrations


TABLES = (
    'auth_group',
    'auth_group_permissions',
    'auth_permission',
    'auth_user',
    'auth_user_groups',
    'auth_user_user_permissions',
    'django_admin_log',
    'django_content_type',
    'django_migrations',
    'django_session',
    'requests_app_auditevent',
    'requests_app_counselingrequest',
    'requests_app_psychologistaccount',
    'requests_app_queuecounter',
    'requests_app_urgencyrequest',
)


def protect_tables(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return

    with schema_editor.connection.cursor() as cursor:
        for table in TABLES:
            cursor.execute(f'ALTER TABLE public."{table}" ENABLE ROW LEVEL SECURITY')
            cursor.execute(
                f'REVOKE ALL PRIVILEGES ON TABLE public."{table}" '
                'FROM PUBLIC, anon, authenticated, service_role'
            )
            if table == 'django_session':
                continue
            sequence = f'{table}_id_seq'
            cursor.execute(
                f'REVOKE ALL PRIVILEGES ON SEQUENCE public."{sequence}" '
                'FROM PUBLIC, anon, authenticated, service_role'
            )


class Migration(migrations.Migration):
    dependencies = [
        ('admin', '0003_logentry_add_action_flag_choices'),
        ('requests_app', '0001_initial'),
        ('sessions', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(protect_tables, migrations.RunPython.noop),
    ]
