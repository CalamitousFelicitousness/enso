# Library and Recipes

The Library tab in the Right Panel keeps input frames, sets of inputs and
recipes on the server. Every browser that connects to the server sees the same
library.

## What the Library Keeps

| Kind | What it holds | A click on its card |
| --- | --- | --- |
| Frame | One input frame: its role, pictures, mask and settings | Adds it to the inputs |
| Set | Every input frame as it stood | Replaces the inputs with it |
| Recipe | The prompt, the settings, the model, the LoRAs and the input pictures of one generation | Opens Restore |

Unpinned entries are kept up to the library's size (Saved entries kept under
Settings, Behavior; 100 by default). A save past it moves the least recently
used unpinned entry to the trash, and the save's notice names it. Up to 20
entries can be pinned. Removed entries wait in the Trash list for the days set
by Keep the trash for (7 by default) and can be put back until then.

## Saving a Recipe

A recipe is a generation kept instead of run. Save one from:

- the Input tab's header (Save recipe), or the palette's Save a recipe: the
  inputs and settings as they stand;
- a result in the Result Strip, a History card or a Gallery file: the job that
  made it, with the seed its picture was made with and the picture as the
  card's preview.

Only an image generation can be saved as a recipe. Settings that name a file
on this server, such as a Color LUT from a folder, are left out and the save's
notice says which.

## Using a Recipe

- **Restore** opens a dialog that compares the recipe with the current settings
  and inputs, row by row, with the model on its own row. Restore the settings,
  the inputs or both.
- **Run** sends the recipe as it is. When this server has its model and another
  is loaded, the model is loaded first, in queue order. When the server lacks
  the model, the recipe runs on the loaded one and the notice says so.
- **Find on CivitAI** looks up the models this server lacks by their hash and
  offers to download them.

A card's second line gives the model's state on this server:

| State | Meaning |
| --- | --- |
| Installed | The same file, matched by hash |
| Other file | A model with this name is installed, but its hash differs |
| Not checked | Installed by name; the file has not been hashed yet |
| Not found | This server has no model of this name or hash |

## Recipe Files

Any library entry can be exported as an `.enso` file: the card's Export, or
Export as a recipe file in the Input tab's header for the inputs and settings
as they stand without saving them. The browser downloads the file the server
packs; the server keeps it for an hour.

To bring a file in:

- the Import button beside the Library's search, or the palette's Import a
  recipe file;
- drop it on the Library tab;
- drop or paste it on the canvas, which opens Restore for the recipe.

An import that matches an entry the library already holds (the same file, or
one exported from it) answers with that entry rather than adding a second.
The notice's Show in library finds the card.

An `.enso` file is a ZIP archive: a `mimetype` member, a `recipe.json`
description, and each picture under `blobs/` named by its SHA-256. The server
checks every member against its name and its size limits before it keeps
anything, and refuses a file made by a newer version of Enso with the version
it saw. Nothing server-specific travels: no paths, users, job ids or processed
maps; an imported recipe makes its maps again when it runs.
