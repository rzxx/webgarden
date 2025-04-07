<script lang="ts">
  import GardenCanvas from './lib/GardenCanvas.svelte';
  import GardenUI from './lib/GardenUI.svelte'; // Import the UI component
</script>

<main>
  <GardenCanvas />
  <GardenUI />
</main>

<style>
  main {
    padding: 0;
    margin: 0;
    width: 100vw;
    height: 100vh;
    display: block;
    position: relative; /* Needed for absolute positioning of UI */
    overflow: hidden;
  }

  :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
  }
</style>
