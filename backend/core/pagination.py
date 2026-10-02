"""Paginación de la API."""
from rest_framework.pagination import PageNumberPagination


class PaginacionEstandar(PageNumberPagination):
    """
    Permite que el cliente pida el tamaño de página con ?page_size=, como ya
    asumen varias pantallas del frontend (alumnos, insignias, avisos...).
    Sin esto, PageNumberPagination ignora ese parámetro en silencio y siempre
    regresa el PAGE_SIZE global — lo que truncaba, por ejemplo, el listado de
    destinatarios de un Aviso masivo a solo 25 filas sin avisar.
    """

    page_size_query_param = "page_size"
    max_page_size = 500
