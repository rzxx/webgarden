# 3D WebGarden

[Русский 👈](README.md)

Hosted at [3d-webgarden.netlify.app](https://3d-webgarden.netlify.app/). Start setting up your corner of the internet now!

## What is it?

A web application built with Svelte using Three.js. It includes a 3D editor for a personal garden and a system of customizable widgets.

**Mobile device support is not provided! Expect bugs and unstable perfomance.**

## Features

Currently available:

- Placing and removing plants and decor.
- Caring for plants *(watering)*.
- Observing the change of day and night *(linked to device time!)*.
- Adding widgets to the screen *(currently only time and date, in development)*.

## How to use it?

The application has two modes: viewing and editing. You can switch between them using the **gear button in the lower right corner (⚙️)**.

### Viewing Mode

**Minimal interface** - only watering plants is possible.

### Editing Mode

All changes happen here. Here are the main elements:

- **Panel with inventory and tools (watering, removing objects).** This panel displays all available objects for placement with their quantity, as well as tool buttons (watering, removing). *To place an object, drag the object icon onto the garden plane.*
- **Widget management panel.** *In development!* Here you can add available widgets and delete all of them at once.
- **Selected object panel.** **Click on any object on the plane to see information about it.**
- **Widget editing.** For each widget placed on the screen, delete and settings editing buttons appear.
