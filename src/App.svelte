<script lang="ts">
  import GardenCanvas from './lib/GardenCanvas.svelte';
  import GardenUI from './lib/GardenUI.svelte'; // Import the UI component
  import WidgetContainer from './lib/WidgetContainer.svelte'; // Import the container
  import WidgetGridOverlay from './lib/WidgetGridOverlay.svelte'; // Import the overlay
  import { uiMode } from './lib/stores'; // Import uiMode store
  import WidgetSettingsModal from './lib/WidgetSettingsModal.svelte'; // Import the modal
  import { onMount } from 'svelte';

  let showGarden = false;
  let initialUiReady = false;

  onMount(() => {
        const timer = setTimeout(() => {
            console.log("Timer elapsed, showing GardenCanvas");
            showGarden = true;
        }, 300); // Small delay

        initialUiReady = true;

        return () => clearTimeout(timer); // Cleanup timer on component destroy
    });
</script>

<svelte:head>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0" />
</svelte:head>

<main>
  {#if showGarden}
    <GardenCanvas />
  {/if}

  {#if initialUiReady}
    <GardenUI />
  {/if}

  <!-- Conditionally render WidgetContainer in view mode -->
  {#if $uiMode === 'view'}
    <WidgetContainer />
  {/if}

  <!-- Conditionally render WidgetGridOverlay in edit mode -->
  {#if $uiMode === 'edit'}
    <WidgetGridOverlay />
  {/if}

  <!-- Render the modal (it will control its own visibility) -->
  <WidgetSettingsModal />
</main>

<style>
  main {
    padding: 0;
    margin: 0;
    width: 100vw;
    height: 100vh;
    display: block;
    position: relative; /* Needed for absolute positioning of children */
    overflow: hidden; /* Prevent scrollbars */
  }

  :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
  }
</style>
