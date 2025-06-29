# 3D WebGarden

[Русский 👈](README_ru.md)

Hosted at [3d-webgarden.netlify.app](https://3d-webgarden.netlify.app/). Start setting up your corner of the internet now!

## What is it?

A web application built with Svelte using Three.js. It includes a 3D editor for a personal garden and a system of customizable widgets.

![screenshot](https://github.com/user-attachments/assets/b7f1b114-e9df-46e9-9486-d60bbde33642)

## Features

Currently available:

- Placing and removing plants and decor.

  ![placing-removing](https://github.com/user-attachments/assets/2885b9c3-d03d-4247-9744-1016041c372d)
  
- Caring for plants *(watering)*.

  ![watering](https://github.com/user-attachments/assets/8d1d302b-bffb-4b44-a9ae-7035d93df76e)

- Observing the change of day and night *(linked to device time!)*.

  ![time](https://github.com/user-attachments/assets/4912de76-f69c-4f79-aa21-b9dec341e077)

- Adding widgets to the screen *(currently only time, date and weather, in development)*.

  ![widget](https://github.com/user-attachments/assets/fc57fb90-f42a-4678-9856-3810351d3c4d)

**Widgets support on mobile devices is not provided.**

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
