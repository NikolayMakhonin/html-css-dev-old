<style lang="postcss">
    @import '../nested/style.pcss';
</style>

<script lang="ts">
    let value: number = 0
</script>

<div class="component" on:click={() => value++}>
    Component {value}
</div>
