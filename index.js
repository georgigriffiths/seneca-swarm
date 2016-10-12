'strict'
module.exports = function swarm (options) {
  var seneca = this
  var plugin = 'swarm'
  seneca.depends(plugin, 'docker-machine', 'flow', 'docker')
  seneca.add({
    role: plugin,
    cmd: 'manage',
    replicas: {
      integer$: true,
      required$: true
    },
    type: {
      enum$: ['manager', 'worker']
    }
  }, manage)

  function manage (msg, done) {
    seneca.act({
      flow: {
        times: msg.replicas,
        iterate: {
          $extend: {
            $machine: {
              type: msg.type,
              $id: '$.index'
            }
          },
          sequence: [{
            role: 'docker-machine',
            cmd: 'machine-command',
            command: 'status',
            key$: 'status'
          }, {
            if$: '$.status == "Stopped" || $.status == "Error"',
            role: 'docker-machine',
            cmd: 'machine-command',
            command: 'rm',
            args: {
              force: true
            }
          }, {
            if$: '$.status != "Running"',
            role: plugin,
            cmd: 'create-machine',
            exit$: '$.status === "Running"'
          }, {
            role: plugin,
            cmd: 'swarm-leader',
            key$: 'swarm_leader'
          }, {
            role: plugin,
            cmd: 'swarm-join-token',
            type: msg.type,
            $swarm_leader: '$',
            key$: 'token'
          }, {
            role: 'docker',
            command: 'swarm join',
            $args: {
              $token: '$.token'
            },
            $extra: '$.swarm_leader.addr'
          }]
        }
      }
    }, done)
  }
  seneca.add({
    role: plugin,
    cmd: 'create-machine'
  }, create_machine)

  function create_machine (msg, done) {
    seneca.act({
      flow: {
        sequence: [
          {
            role: 'docker-machine',
            cmd: 'create',
            machine: msg.machine
          }, {
            registry: options.registry,
            if$: '$.registry',
            role: 'docker',
            command: 'login',
            machine: msg.machine,
            $username: '$.registry.username',
            $password: '$.registry.password',
            $provider: '$.registry.name'
          }
        ]
      }
    }, done)
  }

  seneca.add({
    role: plugin,
    cmd: 'start'
  }, start)

  function start (msg, done) {
    seneca.act({
      flow: {
        extend: {
          machine: {
            type: 'manager',
            id: 0
          }
        },
        sequence: [{
          role: plugin,
          cmd: 'create-machine'
        }, {
          role: 'docker',
          command: 'swarm init',
          args: {
            'advertise-addr': 'eth1'
          }
        }]
      }
    }, done)
  }

  seneca.add({
    role: plugin,
    cmd: 'fleet',
    managers: {
      type$: 'integer'
    },
    workers: {
      type$: 'integer'
    }
  }, fleet)

  function fleet (msg, done) {
    seneca.act({
      flow: {
        sequence: [{
          role: plugin,
          cmd: 'start'
        }, {
          role: plugin,
          cmd: 'maintain',
          managers: msg.managers,
          workers: msg.workers
        }]
      }
    }, done)
  }

  seneca.add({
    role: plugin,
    cmd: 'maintain',
    managers: {
      type$: 'integer'
    },
    workers: {
      type$: 'integer'
    }
  }, maintain)

  function maintain (msg, done) {
    seneca.act({
      flow: {
        parallel: [{
          role: plugin,
          cmd: 'manage',
          replicas: msg.managers,
          type: 'manager'
        }, {
          role: plugin,
          cmd: 'manage',
          replicas: msg.workers,
          type: 'worker'
        }]
      }
    }, done)
  }


  seneca.add({
    role: plugin,
    cmd: 'swarm-members'
  }, swarm_members)

  function swarm_members (msg, done) {
    seneca.act({
      flow: {
        role: 'docker',
        $machine: {
          role: plugin,
          cmd: 'swarm-manager'
        },
        command: 'node ls',
        out$: {
          role: 'format',
          cmd: 'text-table'
        }
      }
    }, done)
  }


  seneca.add({
    role: plugin,
    cmd: 'swarm-join-token',
    type: {
      enum$: ['manager', 'worker']
    }
  }, swarm_join_token)

  function swarm_join_token (msg, done) {
    seneca.act({
      flow: {
        role: 'docker',
        machine: msg.swarm_leader,
        command: 'swarm join-token',
        args: {
          quiet: true
        },
        extra: msg.type
      }
    }, done)
  }

  seneca.add({
    role: plugin,
    cmd: 'swarm-leader'
  }, swarm_leader)

  function swarm_leader (msg, done) {
    seneca.act({
      flow: {
        sequence: [{
          role: 'docker-machine',
          cmd: 'list',
          type: 'manager'
        }, {
          if$: '$.in.length',
          $with: '$.in',
          iterate: {
            if$: '$.in.state === "Running"',
            role: 'docker',
            $machine: '$.in',
            command: 'node inspect self',
            format: 'json',
            out$: {
              _: 'get',
              args: '[0].ManagerStatus'
            }
          },
          exit: "_.get(out,'Leader')",
          key$: 'machine',
          out$: [{
            if$: '_.last($.in).Leader',
            type: 'manager',
            $id: '$.in.length-1',
            $addr: '$.in[$.in.length-1].Addr'
          }]
        }],
        out$: [{
          _: 'get',
          args: 'machine'
        }, {
          _: 'omit',
          args: 'in'
        }]
      }
    }, done)
  }

  seneca.ready(function () {
    if (process.argv[2] === 'fleet') {
      seneca.act({
        role: plugin,
        cmd: 'fleet',
        managers: parseInt(process.argv[3], 10),
        workers: parseInt(process.argv[4], 10)
      })
    }

    if (process.argv[2] === 'maintain') {
      seneca.act({
        role: plugin,
        cmd: 'maintain',
        managers: parseInt(process.argv[3], 10),
        workers: parseInt(process.argv[4], 10)
      })
    }
  })

  return plugin
}
