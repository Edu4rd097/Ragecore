"""
Autenticación y resolución de rol.

El frontend necesita saber, en una sola llamada, quién entró y qué puede ver.
"""
from django.contrib.auth import authenticate, get_user_model
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .permissions import alumno_de, es_administrativo, maestro_de
from .serializers import AlumnoDetailSerializer, MaestroSerializer


def _payload_usuario(user, request=None):
    alumno = alumno_de(user)
    maestro = maestro_de(user)
    if es_administrativo(user):
        rol = "ADMINISTRATIVO"
    elif maestro is not None:
        rol = "MAESTRO"
    elif alumno is not None:
        rol = "ALUMNO"
    else:
        rol = "SIN_ROL"

    datos = {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "nombre": user.get_full_name() or user.username,
        "rol": rol,
        "alumno_id": alumno.id if alumno else None,
        "maestro_id": maestro.id if maestro else None,
    }
    if alumno is not None:
        datos["alumno"] = AlumnoDetailSerializer(
            alumno, context={"request": request}
        ).data
    if maestro is not None:
        datos["maestro"] = MaestroSerializer(
            maestro, context={"request": request}
        ).data
    return datos


@api_view(["POST"])
@permission_classes([AllowAny])
def login(request):
    """
    POST /api/auth/login/  {"username": "...", "password": "..."}

    Devuelve el token y el rol, para que el frontend sepa a qué dashboard
    redirigir sin una segunda llamada.
    """
    identificador = (request.data.get("username") or "").strip()
    password = request.data.get("password") or ""

    if not identificador or not password:
        return Response(
            {"detail": "Usuario y contraseña son obligatorios."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # 'username' es único, pero el correo NO — varios alumnos pueden compartir
    # una sola cuenta de correo (ej. hermanos con el mismo tutor). Si el
    # identificador trae "@", además del match directo de username se
    # intenta cada cuenta que tenga ese correo, hasta que una autentique con
    # esa contraseña.
    candidatos = [identificador]
    if "@" in identificador:
        User = get_user_model()
        candidatos += list(
            User.objects.filter(email=identificador).values_list("username", flat=True)
        )

    user = None
    for candidato in dict.fromkeys(candidatos):
        user = authenticate(username=candidato, password=password)
        if user:
            break

    if user is None:
        return Response(
            {"detail": "Usuario o contraseña incorrectos."},
            status=status.HTTP_401_UNAUTHORIZED,
        )
    if not user.is_active:
        return Response(
            {"detail": "Esta cuenta está desactivada."},
            status=status.HTTP_403_FORBIDDEN,
        )

    token, _ = Token.objects.get_or_create(user=user)
    return Response({"token": token.key, "usuario": _payload_usuario(user, request)})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def yo(request):
    """GET /api/auth/yo/ — rehidrata la sesión al recargar la PWA."""
    return Response(_payload_usuario(request.user, request))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def logout(request):
    """POST /api/auth/logout/ — invalida el token actual."""
    Token.objects.filter(user=request.user).delete()
    return Response({"detail": "Sesión cerrada."})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def cambiar_password(request):
    """POST /api/auth/cambiar-password/ {"actual": "...", "nueva": "..."}"""
    actual = request.data.get("actual") or ""
    nueva = request.data.get("nueva") or ""

    if not request.user.check_password(actual):
        return Response(
            {"detail": "La contraseña actual no es correcta."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if len(nueva) < 8:
        return Response(
            {"detail": "La nueva contraseña debe tener al menos 8 caracteres."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    request.user.set_password(nueva)
    request.user.save()
    Token.objects.filter(user=request.user).delete()
    token = Token.objects.create(user=request.user)
    return Response({"detail": "Contraseña actualizada.", "token": token.key})
