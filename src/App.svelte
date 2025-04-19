<script lang="ts">
  import GardenCanvas from './lib/GardenCanvas.svelte';
  import GardenUI from './lib/GardenUI.svelte'; // Import the UI component
  import WidgetContainer from './lib/WidgetContainer.svelte'; // Import the container
  import WidgetGridOverlay from './lib/WidgetGridOverlay.svelte'; // Import the overlay
  import { uiMode } from './lib/stores'; // Import uiMode store
  import WidgetSettingsModal from './lib/WidgetSettingsModal.svelte'; // Import the modal
</script>

<main>
  <GardenCanvas />
  <GardenUI />

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
