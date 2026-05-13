// See https://kit.svelte.dev/docs/types#app
declare global {
	namespace App {
		interface Error {}
		interface Locals {}
		interface PageData {
			session?: import('@auth/sveltekit').Session | null;
		}
		interface PageState {}
		interface Platform {}
	}
}

export {};
