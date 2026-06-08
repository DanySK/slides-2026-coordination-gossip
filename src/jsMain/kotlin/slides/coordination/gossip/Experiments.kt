package slides.coordination.gossip

import it.unibo.collektive.Collektive
import it.unibo.collektive.aggregate.Field
import it.unibo.collektive.aggregate.FieldEntry
import it.unibo.collektive.aggregate.api.Aggregate
import it.unibo.collektive.aggregate.api.share
import it.unibo.collektive.aggregate.api.sharing
import it.unibo.collektive.aggregate.values
import it.unibo.collektive.networking.Message
import it.unibo.collektive.networking.NeighborsData
import it.unibo.collektive.path.FullPathFactory
import it.unibo.collektive.path.Path
import it.unibo.collektive.state.State
import it.unibo.collektive.stdlib.collapse.max
import it.unibo.collektive.stdlib.collapse.min
import it.unibo.collektive.stdlib.collapse.minBy
import it.unibo.collektive.stdlib.collapse.reduce
import it.unibo.collektive.stdlib.spreading.gossipMin
import it.unibo.collektive.stdlib.spreading.hopGradientCast
import kotlin.js.json
import kotlin.math.abs
import kotlin.math.pow
import kotlin.math.round

/**
 * Browser entry point for Collektive-backed experiments.
 *
 * JavaScript-facing contract:
 *
 *   globalThis.CollektiveExperiments["experiment-name"](snapshot) -> outputs
 *
 * snapshot:
 *   {
 *     nodes: [{ id: Int, x: Double, y: Double }],
 *     edges: [{ source: Int, target: Int, distance: Double }],
 *     parameters: { communicationRange: Double, mobility: Double }
 *   }
 *
 * outputs:
 *   [{ id: Int, value: Number, label?: String }]
 *
 * Add new entries in installExperiments(). The current functions make the
 * Kotlin/JS path executable; replace them with real Collektive programs as
 * they become available.
 */
fun main() {
    installExperiments()
}

fun Aggregate<Int>.gradient() = hopGradientCast(localId == 2, 0) { fromSource, toNeighbor, data -> fromSource + toNeighbor }
fun Aggregate<Int>.gradient2() = hopGradientCast(localId == 0, 0) { fromSource, toNeighbor, data -> fromSource }
fun Aggregate<Int>.gradient3() = hopGradientCast(localId == 0, 0) { fromSource, toNeighbor, data -> fromSource }
fun Aggregate<Int>.classicGossipMin() = share(localId) { it.all.values.min() }

private fun installExperiments() {
    val registry = experimentsRegistry()
    data class Entry(val id: Int, val path: List<Int> = emptyList()) : Comparable<Entry> {
        override fun compareTo(other: Entry): Int = compareBy<Entry> { it.id }
            .thenBy { it.path.size }
            .thenBy { it.path.lastOrNull() }
            .compare(this, other)

        override fun toString() = "$id[${path.joinToString("->")}]"
    }

    registry["degree"] = ::degree
    registry["component-min"] = ::componentMin
    registerCollektive(registry, "gradient") { this.gradient() }
    registerCollektive(registry, "standard-gossip") { classicGossipMin() }
    registerCollektive(registry, "restart-gossip") {
        evolving(0) {
            (it + 1).yielding {
                when (it % 200) {
                    in 0..99 -> classicGossipMin()
                    else -> classicGossipMin()
                }
            }
        }
    }
    registerCollektive(registry, "gossip-min") { gossipMin(localId) }
    registerCollektive(registry, "track", colorSource = { (it as Entry).component1() }) {
        share(Entry(localId)) { paths ->
            val bestEntry = paths.map { (id, entry) ->
                when {
                    localId in entry.path -> Entry(localId)
                    else -> entry.copy(path = entry.path + id)
                }
            }.neighbors.values.min()
            minOf(bestEntry ?: Entry(localId), Entry(localId))
        }
    }
    registerCollektive(registry, "gossip-union") {
        share(listOf(localId)) { it.all.values.reduce { a, b -> a + b }.distinct().sorted() }
    }
}

private class CollektiveRuntime(
    private val program: Aggregate<Int>.() -> Any?,
    private val colorSource: (Any?) -> Any?,
) {
    private val memories: MutableMap<String, RuntimeMemory> = mutableMapOf()

    fun reset(instanceId: String?) {
        if (instanceId == null) memories.clear() else memories.remove(instanceId)
    }

    fun run(snapshot: Snapshot): Array<DeviceOutput> {
        val memory = memories.getOrPut(snapshot.instanceId ?: "default") { RuntimeMemory() }
        val nodeIds = snapshot.nodes.map { it.id }.toSet()
        val neighbors = snapshot.neighborsByNode()
        memory.states = memory.states.filterKeys { it in nodeIds }.toMutableMap()
        memory.inboundMessages = memory.inboundMessages.filterKeys { it in nodeIds }

        val results = snapshot.nodes.associate { node ->
            val result = Collektive.aggregate(
                localId = node.id,
                previousState = memory.states[node.id] ?: emptyMap(),
                inbound = inboundData(node.id, neighbors.getValue(node.id), memory.inboundMessages[node.id].orEmpty()),
                inMemory = true,
                pathFactory = FullPathFactory,
                compute = program,
            )
            memory.states[node.id] = result.newState
            node.id to result
        }

        val nextInbound = nodeIds.associateWith { mutableListOf<Message<Int, *>>() }
        results.forEach { (sender, result) ->
            neighbors.getValue(sender).forEach { receiver ->
                nextInbound.getValue(receiver).add(result.toSend.prepareMessageFor(receiver))
            }
        }
        memory.inboundMessages = nextInbound

        return snapshot.nodes.map { node ->
            val result = results.getValue(node.id).result
            output(node.id, result, colorSource(result))
        }.toTypedArray()
    }

    private fun Snapshot.neighborsByNode(): Map<Int, Set<Int>> {
        val result = nodes.associate { it.id to mutableSetOf<Int>() }
        edges.forEach { edge ->
            result.getValue(edge.source) += edge.target
            result.getValue(edge.target) += edge.source
        }
        return result
    }

    private fun inboundData(localId: Int, neighbors: Set<Int>, messages: List<Message<Int, *>>): NeighborsData<Int> =
        object : NeighborsData<Int> {
            override val neighbors: Set<Int> = neighbors

            @Suppress("UNCHECKED_CAST")
            override fun <Value> dataAt(path: Path, dataSharingMethod: it.unibo.collektive.aggregate.api.DataSharingMethod<Value>):
                Map<Int, Value> = buildMap {
                    messages.asSequence()
                        .filter { it.senderId in neighbors }
                        .filter { path in it.sharedData }
                        .forEach { message ->
                            put(message.senderId, message.sharedData[path] as Value)
                        }
                }

            override fun toString(): String = "InboundData(localId=$localId, neighbors=$neighbors)"
        }
}

private data class RuntimeMemory(
    var states: MutableMap<Int, State> = mutableMapOf(),
    var inboundMessages: Map<Int, List<Message<Int, *>>> = emptyMap(),
)

private fun registerCollektive(
    registry: dynamic,
    name: String,
    colorSource: (Any?) -> Any? = { it },
    program: Aggregate<Int>.() -> Any?,
) {
    val runtime = CollektiveRuntime(program, colorSource)
    val run: Experiment = runtime::run
    run.asDynamic().reset = runtime::reset
    registry[name] = run
}

private fun degree(snapshot: Snapshot): Array<DeviceOutput> {
    val degree = snapshot.nodes.associate { it.id to 0 }.toMutableMap()
    snapshot.edges.forEach { edge ->
        degree[edge.source] = degree.getValue(edge.source) + 1
        degree[edge.target] = degree.getValue(edge.target) + 1
    }
    return snapshot.nodes.map { node ->
        output(node.id, degree.getValue(node.id))
    }.toTypedArray()
}

private fun componentMin(snapshot: Snapshot): Array<DeviceOutput> {
    val adjacency = snapshot.nodes.associate { it.id to mutableListOf<Int>() }.toMutableMap()
    snapshot.edges.forEach { edge ->
        adjacency.getValue(edge.source) += edge.target
        adjacency.getValue(edge.target) += edge.source
    }

    val seen = mutableSetOf<Int>()
    val result = mutableMapOf<Int, Int>()

    snapshot.nodes.forEach { node ->
        if (node.id !in seen) {
            val queue = ArrayDeque<Int>().apply { add(node.id) }
            val component = mutableListOf<Int>()
            seen += node.id

            while (queue.isNotEmpty()) {
                val current = queue.removeFirst()
                component += current
                adjacency.getValue(current).forEach { neighbor ->
                    if (seen.add(neighbor)) queue.add(neighbor)
                }
            }

            val minimum = component.min()
            component.forEach { result[it] = minimum }
        }
    }

    return snapshot.nodes.map { node ->
        output(node.id, result.getValue(node.id))
    }.toTypedArray()
}

private fun output(id: Int, result: Any?, colorSource: Any? = result): DeviceOutput =
    json(
        "id" to id,
        "value" to colorValue(colorSource),
        "label" to result.toString(),
    ).unsafeCast<DeviceOutput>()

private fun colorValue(result: Any?): Double = colorValue(result, inspectComponents = true) ?: 0.0

private fun colorValue(result: Any?, inspectComponents: Boolean): Double? =
    when (result) {
        is Number -> result.toDouble()
        is Boolean -> if (result) 0.75 else 0.25
        is Collection<*> -> result.size.toDouble()
        is Map<*, *> -> result.size.toDouble()
        is Array<*> -> result.size.toDouble()
        else -> if (inspectComponents) firstComponentColorValue(result) else null
    }

private fun firstComponentColorValue(result: Any?): Double? =
    (1..3)
        .asSequence()
        .mapNotNull { componentIndex -> componentValue(result, componentIndex) }
        .mapNotNull { component -> colorValue(component, inspectComponents = false) }
        .firstOrNull()

private fun componentValue(result: Any?, componentIndex: Int): Any? {
    if (result == null) return null
    val component = result.asDynamic()["component$componentIndex"]
    return if (jsTypeOf(component) == "function") component.call(result) else null
}

private fun experimentsRegistry(): dynamic {
    val global = js("globalThis")
    val registry = global.CollektiveExperiments ?: json()
    global.CollektiveExperiments = registry
    return registry
}

private typealias Experiment = (Snapshot) -> Array<DeviceOutput>

private external interface Snapshot {
    val instanceId: String?
    val nodes: Array<Node>
    val edges: Array<Edge>
    val parameters: Parameters
}

private external interface Node {
    val id: Int
    val x: Double
    val y: Double
}

private external interface Edge {
    val source: Int
    val target: Int
    val distance: Double
}

private external interface Parameters {
    val communicationRange: Double
    val mobility: Double
}

private external interface DeviceOutput {
    val id: Int
    val value: Double
    val label: String
}
