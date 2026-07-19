import org.jetbrains.kotlin.gradle.targets.js.dsl.KotlinJsTargetDsl
import org.jetbrains.kotlin.gradle.targets.js.webpack.KotlinWebpackConfig

plugins {
    kotlin("multiplatform") version "2.4.10"
    id("it.unibo.collektive.collektive-plugin") version "28.3.1"
}

repositories {
    mavenCentral()
}

kotlin {
    js {
        browser {
            commonWebpackConfig {
                outputFileName = "collektive-experiments.js"
            }
        }
        binaries.executable()
    }

    sourceSets {
        jsMain {
            dependencies {
                implementation("it.unibo.collektive:collektive-dsl:28.3.1")
                implementation("it.unibo.collektive:collektive-stdlib:28.3.1")
            }
        }
    }
}

tasks.register<Copy>("syncCollektiveExperimentsToHugoStatic") {
    group = "distribution"
    description = "Copies the Kotlin/JS browser bundle into Hugo static assets."
    val target = layout.projectDirectory.dir("static/js")
    dependsOn(tasks.named("jsBrowserDistribution"))
    outputs.upToDateWhen { false }

    from(layout.buildDirectory.dir("dist/js/productionExecutable")) {
        include("collektive-experiments.js")
        include("collektive-experiments.js.map")
    }
    into(target)
    doFirst {
        target.asFile.walkTopDown().filter { it.name.startsWith("collektive-experiments") }.forEach { it.delete()}
    }
}

tasks.matching { it.name in setOf("jsBrowserProductionWebpack", "jsBrowserDistribution") }.configureEach {
    outputs.upToDateWhen { false }
}
