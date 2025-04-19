import { writable } from 'svelte/store';

interface ModalState {
    isOpen: boolean;
    widgetId: string | null;
    componentName: string | null;
}

const initialModalState: ModalState = {
    isOpen: false,
    widgetId: null,
    componentName: null,
};

export const modalStore = writable<ModalState>(initialModalState);

export function openSettingsModal(widgetId: string, componentName: string) {
    modalStore.set({
        isOpen: true,
        widgetId: widgetId,
        componentName: componentName,
    });
}

export function closeSettingsModal() {
    modalStore.set(initialModalState);
}