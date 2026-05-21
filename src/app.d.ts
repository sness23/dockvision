// See https://kit.svelte.dev/docs/types#app
// SvelteKit's idiomatic empty interfaces — rule conflicts with the framework convention.
/* eslint-disable @typescript-eslint/no-empty-object-type */
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
