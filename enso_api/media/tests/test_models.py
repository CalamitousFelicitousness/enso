import pytest
from pydantic import TypeAdapter, ValidationError

from enso_api.media.models import ReqAdoptOutputV2, ReqAdoptPathV2

ADOPT = TypeAdapter(ReqAdoptOutputV2 | ReqAdoptPathV2)


def test_an_adoption_names_an_output_or_a_path():
    assert isinstance(ADOPT.validate_python({"output_id": "0123456789abcdef"}), ReqAdoptOutputV2)
    assert isinstance(ADOPT.validate_python({"path": "/outputs/text/a.png"}), ReqAdoptPathV2)


@pytest.mark.parametrize("body", [{}, {"output_id": "0123456789abcdef", "path": "/outputs/text/a.png"}])
def test_an_adoption_naming_both_or_neither_is_refused(body):
    with pytest.raises(ValidationError):
        ADOPT.validate_python(body)
