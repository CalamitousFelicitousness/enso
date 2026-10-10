import os

import pytest

from enso_api.media.layout import Layout
from enso_api.media.schema import MIGRATIONS
from enso_api.media.store import MediaStore
from enso_api.sqlite import Database


@pytest.fixture
def layout(root):
    made = Layout(os.path.join(root, "media"))
    made.make()
    return made


@pytest.fixture
def db(layout):
    opened = Database(layout.db, MIGRATIONS, label="Media store", synchronous="NORMAL")
    yield opened
    opened.close()


@pytest.fixture
def store(layout, db, clock):
    return MediaStore(layout, db, now=clock)
