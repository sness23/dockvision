<script lang="ts">
	import Workspace from '$lib/wm/Workspace.svelte';

	const { data } = $props();
	const userId = $derived(
		Number((data.session?.user as { id?: string | number } | undefined)?.id ?? 0)
	);
	const email = $derived(data.session?.user?.email ?? '');
</script>

<Workspace {userId} userEmail={email} />
