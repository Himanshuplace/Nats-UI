/**
 * TopologyScene — Three.js 3D NATS cluster visualization.
 *
 * Lazy-loaded via React.lazy() — Three.js (~600KB) only fetched when
 * the Topology view is opened, keeping the initial bundle small.
 *
 * Features:
 * - Glowing sphere nodes for each NATS server
 * - Animated particles traveling along cluster routing paths
 * - OrbitControls for 3D exploration
 * - HTML data overlays positioned in 3D space
 * - Reacts to health state: lime=ok, amber=degraded, red=critical
 */
import { useRef, useMemo, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Html, Line } from '@react-three/drei'
import * as THREE from 'three'
import type { NodeInfo } from '@/types'
import { formatNumber } from '@/lib/format'

// ── Constants ─────────────────────────────────────────────────────────────────

const LIME     = new THREE.Color('#a8ff3c')
const AMBER    = new THREE.Color('#ffcc00')
const RED      = new THREE.Color('#ff4040')
const DIM      = new THREE.Color('#1a1a1a')
const BG_COLOR = '#000000'

function nodeColor(health: string): THREE.Color {
  if (health === 'critical') return RED
  if (health === 'degraded') return AMBER
  return LIME
}

// ── Particle system along edges ───────────────────────────────────────────────

interface EdgeParticle {
  progress: number
  speed: number
  from: number
  to: number
}

function EdgeParticles({ positions, throughput }: {
  positions: THREE.Vector3[]
  throughput: number
}) {
  const meshRef  = useRef<THREE.InstancedMesh>(null)
  const particles = useRef<EdgeParticle[]>([])
  const tempMatrix = useRef(new THREE.Matrix4())
  const tempVec    = useRef(new THREE.Vector3())

  // Create particles for each edge
  const edges = useMemo(() => {
    const pairs: [number, number][] = []
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        pairs.push([i, j])
      }
    }
    return pairs
  }, [positions.length])

  const COUNT = Math.min(Math.max(Math.floor(throughput / 2), 3), 30)

  useEffect(() => {
    particles.current = Array.from({ length: COUNT }, (_, k) => ({
      progress: Math.random(),
      speed:    0.003 + Math.random() * 0.005,
      from:     edges[k % edges.length]?.[0] ?? 0,
      to:       edges[k % edges.length]?.[1] ?? 1,
    }))
  }, [COUNT, edges])

  useFrame(() => {
    const mesh = meshRef.current
    if (!mesh || particles.current.length === 0) return

    particles.current.forEach((p, i) => {
      p.progress += p.speed
      if (p.progress > 1) {
        p.progress = 0
        const edge = edges[Math.floor(Math.random() * edges.length)]
        if (edge) { p.from = edge[0]; p.to = edge[1] }
        // Randomly reverse direction
        if (Math.random() > 0.5) { const tmp = p.from; p.from = p.to; p.to = tmp }
      }

      const from = positions[p.from]
      const to   = positions[p.to]
      if (!from || !to) return

      tempVec.current.lerpVectors(from, to, p.progress)
      tempMatrix.current.makeTranslation(
        tempVec.current.x,
        tempVec.current.y,
        tempVec.current.z,
      )
      mesh.setMatrixAt(i, tempMatrix.current)
    })
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, COUNT]}>
      <sphereGeometry args={[0.06, 4, 4]} />
      <meshBasicMaterial color={LIME} />
    </instancedMesh>
  )
}

// ── Single NATS node ──────────────────────────────────────────────────────────

function NodeSphere({ node, position, isLeader }: {
  node: NodeInfo
  position: THREE.Vector3
  isLeader: boolean
}) {
  const meshRef  = useRef<THREE.Mesh>(null)
  const glowRef  = useRef<THREE.Mesh>(null)
  const color    = nodeColor(node.health)
  const t        = useRef(Math.random() * Math.PI * 2)

  useFrame((_, delta) => {
    t.current += delta * (isLeader ? 1.2 : 0.8)
    if (glowRef.current) {
      const s = 1 + Math.sin(t.current) * 0.06
      glowRef.current.scale.setScalar(s)
      ;(glowRef.current.material as THREE.MeshBasicMaterial).opacity =
        0.08 + Math.sin(t.current) * 0.04
    }
    if (meshRef.current) {
      ;(meshRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity =
        0.3 + Math.sin(t.current) * 0.15
    }
  })

  return (
    <group position={position}>
      {/* Outer glow sphere */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[isLeader ? 0.75 : 0.65, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.08} depthWrite={false} />
      </mesh>

      {/* Core sphere */}
      <mesh ref={meshRef}>
        <sphereGeometry args={[isLeader ? 0.42 : 0.35, 24, 24]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.4}
          roughness={0.2}
          metalness={0.6}
        />
      </mesh>

      {/* Leader ring */}
      {isLeader && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.6, 0.018, 8, 40]} />
          <meshBasicMaterial color={LIME} />
        </mesh>
      )}

      {/* HTML data card */}
      <Html
        position={[0, -0.85, 0]}
        center
        style={{ pointerEvents: 'none', userSelect: 'none' }}
        distanceFactor={6}
      >
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '9px',
          color: '#ffffff',
          background: 'rgba(0,0,0,0.85)',
          border: `1px solid ${node.health === 'ok' ? '#a8ff3c' : '#ffcc00'}`,
          padding: '5px 8px',
          minWidth: '110px',
          whiteSpace: 'nowrap',
        }}>
          <div style={{ color: '#a8ff3c', fontWeight: '600', marginBottom: '3px', fontSize: '10px' }}>
            {node.name} {isLeader ? '◆' : ''}
          </div>
          <div style={{ color: '#666', fontSize: '8px', marginBottom: '2px' }}>
            {node.host}:{node.port}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px 8px' }}>
            <span style={{ color: '#555' }}>clients</span>
            <span>{formatNumber(node.clients)}</span>
            <span style={{ color: '#555' }}>subs</span>
            <span>{formatNumber(node.subscriptions)}</span>
            <span style={{ color: '#555' }}>in/s</span>
            <span style={{ color: '#22c55e' }}>{formatNumber(node.inMsgs)}</span>
            <span style={{ color: '#555' }}>out/s</span>
            <span style={{ color: '#06b6d4' }}>{formatNumber(node.outMsgs)}</span>
          </div>
          {node.jetstream && (
            <div style={{ marginTop: '3px', color: '#a855f7', fontSize: '7px', fontWeight: '600' }}>
              ◈ JETSTREAM
            </div>
          )}
        </div>
      </Html>
    </group>
  )
}

// ── Connection lines between nodes ────────────────────────────────────────────

function ClusterEdges({ positions }: { positions: THREE.Vector3[] }) {
  const edges = useMemo(() => {
    const pairs: [THREE.Vector3, THREE.Vector3][] = []
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        pairs.push([positions[i], positions[j]])
      }
    }
    return pairs
  }, [positions])

  return (
    <>
      {edges.map(([a, b], i) => (
        <Line
          key={i}
          points={[a, b]}
          color='#1e1e1e'
          lineWidth={1}
          dashed={false}
        />
      ))}
    </>
  )
}

// ── Scene lighting ────────────────────────────────────────────────────────────

function Lights() {
  return (
    <>
      <ambientLight intensity={0.15} />
      <pointLight position={[8, 8, 8]}  intensity={0.5} color='#ffffff' />
      <pointLight position={[-6, -4, 6]} intensity={0.3} color='#a8ff3c' />
      <pointLight position={[0, -8, -4]} intensity={0.2} color='#0891b2' />
    </>
  )
}

// ── Camera controller ─────────────────────────────────────────────────────────

function CameraSetup() {
  const { camera } = useThree()
  useEffect(() => {
    camera.position.set(0, 0, 9)
    camera.lookAt(0, 0, 0)
  }, [camera])
  return null
}

// ── Main exported scene ───────────────────────────────────────────────────────

interface TopologySceneProps {
  nodes: NodeInfo[]
  totalThroughput: number
}

export function TopologyScene({ nodes, totalThroughput }: TopologySceneProps) {
  // Arrange nodes in a circle (or triangle for 3)
  const positions = useMemo<THREE.Vector3[]>(() => {
    const count  = nodes.length
    const radius = Math.max(2.2, count * 0.8)
    return nodes.map((_, i) => {
      const angle = (i / count) * Math.PI * 2 - Math.PI / 2
      return new THREE.Vector3(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius * 0.6,
        0,
      )
    })
  }, [nodes.length])

  return (
    <Canvas
      camera={{ fov: 50, near: 0.1, far: 100 }}
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      }}
      dpr={Math.min(window.devicePixelRatio, 2)}
      style={{ background: BG_COLOR, width: '100%', height: '100%' }}
    >
      <CameraSetup />
      <Lights />

      {/* Connection lines */}
      <ClusterEdges positions={positions} />

      {/* Message particles traveling along edges */}
      <EdgeParticles positions={positions} throughput={totalThroughput} />

      {/* Node spheres */}
      {nodes.map((node, i) => (
        <NodeSphere
          key={node.name}
          node={node}
          position={positions[i]}
          isLeader={node.role === 'leader'}
        />
      ))}

      {/* Orbit controls — mouse/touch to rotate and zoom */}
      <OrbitControls
        enablePan={false}
        minDistance={4}
        maxDistance={20}
        autoRotate
        autoRotateSpeed={0.4}
        dampingFactor={0.05}
        enableDamping
      />
    </Canvas>
  )
}
