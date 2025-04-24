<script lang="ts">
	import GardenCanvas from './lib/GardenCanvas.svelte';
	import GardenUI from './lib/GardenUI.svelte'; // Import the UI component
	import WidgetContainer from './lib/WidgetContainer.svelte'; // Import the container
	import WidgetGridOverlay from './lib/WidgetGridOverlay.svelte'; // Import the overlay
	import { uiMode, isGardenReady } from './lib/stores'; // Import uiMode store
	import WidgetSettingsModal from './lib/WidgetSettingsModal.svelte'; // Import the modal
	import { onMount } from 'svelte';
	import { getBackgroundColorForTime } from './lib/bgColorCalculate';

	let initialUiReady = false;

	onMount(() => {
		initialUiReady = true;
	});
</script>

<svelte:head>
	<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0" />
</svelte:head>

<main style="background-color: {getBackgroundColorForTime(new Date())};">
	{#if !$isGardenReady}
		<div class="w-dvw h-dvh flex justify-center items-center text-brightblack">
			<span class="material-symbols-outlined animate-spin mr-2">
                progress_activity
            </span>
			<p class="font-outfit">Loading WebGarden...</p>
		</div>
	{/if}

	<GardenCanvas />

	{#if initialUiReady && $isGardenReady}
		<GardenUI />
		{#if $uiMode === 'view'} <WidgetContainer /> {/if}
		{#if $uiMode === 'edit'} <WidgetGridOverlay /> {/if}
		<WidgetSettingsModal />
  	{/if}
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
