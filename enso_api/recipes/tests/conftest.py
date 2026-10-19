import os

import pytest

from enso_api.media.entries import Entries
from enso_api.media.layout import Layout
from enso_api.media.schema import MIGRATIONS
from enso_api.media.store import MediaStore
from enso_api.media.tests.conftest import db, layout, store  # pylint: disable=unused-import
from enso_api.sqlite import Database


@pytest.fixture
def entries(store, db, clock):  # noqa: F811  # pylint: disable=redefined-outer-name
    return Entries(db, store.held, store.settings, clock)


class Server:
    """A second store with its library, as another server holds them."""

    def __init__(self, root: str, clock):
        self.layout = Layout(os.path.join(root, "other"))
        self.layout.make()
        self.db = Database(self.layout.db, MIGRATIONS, label="Media store", synchronous="NORMAL")
        self.store = MediaStore(self.layout, self.db, now=clock)
        self.entries = Entries(self.db, self.store.held, self.store.settings, clock)


@pytest.fixture
def other(root, clock):
    made = Server(root, clock)
    yield made
    made.db.close()
