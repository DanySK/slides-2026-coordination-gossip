package slides.coordination.gossip

import it.unibo.collektive.Collektive
import it.unibo.collektive.aggregate.api.Aggregate
import it.unibo.collektive.networking.Message
import it.unibo.collektive.networking.NeighborsData
import it.unibo.collektive.path.FullPathFactory
import it.unibo.collektive.path.Path
import it.unibo.collektive.state.State
import it.unibo.collektive.stdlib.spreading.hopGradientCast
import kotlin.js.json

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

fun Aggregate<Int>.gradient() = hopGradientCast(localId == 0, 0) { fromSource, toNeighbor, data -> fromSource + toNeighbor }
fun Aggregate<Int>.gradient2() = hopGradientCast(localId == 0, 0) { fromSource, toNeighbor, data -> fromSource }
fun Aggregate<Int>.gradient3() = hopGradientCast(localId == 0, 0) { fromSource, toNeighbor, data -> fromSource }

private fun installExperiments() {
    val registry = experimentsRegistry()
    registry["degree"] = ::degree
    registry["component-min"] = ::componentMin
    registry["gradient"] = CollektiveRuntime { gradient() }::run
    registry["gradient2"] = CollektiveRuntime { gradient2() }::run
    registry["gradient3"] = CollektiveRuntime { gradient3() }::run
}

private class CollektiveRuntime(
    private val program: Aggregate<Int>.() -> Int,
) {
    private var states: MutableMap<Int, State> = mutableMapOf()
    private var inboundMessages: Map<Int, List<Message<Int, *>>> = emptyMap()

    fun run(snapshot: Snapshot): Array<DeviceOutput> {
        val nodeIds = snapshot.nodes.map { it.id }.toSet()
        val neighbors = snapshot.neighborsByNode()
        states = states.filterKeys { it in nodeIds }.toMutableMap()
        inboundMessages = inboundMessages.filterKeys { it in nodeIds }

        val results = snapshot.nodes.associate { node ->
            val result = Collektive.aggregate(
                localId = node.id,
                previousState = states[node.id] ?: emptyMap(),
                inbound = inboundData(node.id, neighbors.getValue(node.id), inboundMessages[node.id].orEmpty()),
                inMemory = true,
                pathFactory = FullPathFactory,
                compute = program,
            )
            states[node.id] = result.newState
            node.id to result
        }

        val nextInbound = nodeIds.associateWith { mutableListOf<Message<Int, *>>() }
        results.forEach { (sender, result) ->
            neighbors.getValue(sender).forEach { receiver ->
                nextInbound.getValue(receiver).add(result.toSend.prepareMessageFor(receiver))
            }
        }
        inboundMessages = nextInbound

        return snapshot.nodes.map { node ->
            output(node.id, results.getValue(node.id).result)
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
                    messages
                        .asSequence()
                        .filter { it.senderId in neighbors }
                        .filter { path in it.sharedData }
                        .forEach { message ->
                            put(message.senderId, message.sharedData[path] as Value)
                        }
                }

            override fun toString(): String = "InboundData(localId=$localId, neighbors=$neighbors)"
        }
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

private fun output(id: Int, value: Int): DeviceOutput =
    json(
        "id" to id,
        "value" to value,
        "label" to value.toString(),
    ).unsafeCast<DeviceOutput>()

private fun experimentsRegistry(): dynamic {
    val global = js("globalThis")
    val registry = global.CollektiveExperiments ?: json()
    global.CollektiveExperiments = registry
    return registry
}

private typealias Experiment = (Snapshot) -> Array<DeviceOutput>

private external interface Snapshot {
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
    val value: Int
    val label: String
}
