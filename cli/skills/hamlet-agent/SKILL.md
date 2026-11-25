---
name: hamlet-agent
description: 在 Hamlet 托管会话中编写子 Agent 的首轮任务、组织跨机器群协作、编写 doorbell 脚本或级联删除子节点时使用。
---

# Hamlet 协作参考

## 派工与纠正

先用 `agent_list` 看直属子节点的职责、title 和运行状态。职责合适时用 `message_to` 派新任务。创建子节点时，从 `machine_list` 选择稳定的 machine_id，填写那台机器上的目录。多人同时修改同一 Git 仓库时，可用 worktree。重试同一次创建时沿用 request_id。

子节点不会继承你的聊天记录。比如要它跟进一个工单，可以这样写首轮任务：

> 在当前工作树处理工单 #42。复现步骤和验收条件在工单里。等维护者补上日志后再动手，由你监听日志到达。提交修复并跑相关测试，完成时用 message_to 发我提交号和测试结果。若无法复现，把缺少的信息发给我。

方向偏了时，在 `agent_list` 取当前 turn_id，用 `agent_steer` 把纠正直接交给该回合，或用 `agent_interrupt` 停止它。若得到 turn_changed，重新确认状态。

## 群和图片

同一父节点的直属子节点可以跨机器建群。建群者要发送或接收广播，创建时需传 `include_self: true`。广播投递给除发送者外的群成员。私信可以发给父节点、直属子节点或同群成员。用 `message_to` 附图片和说明，接收者可以用 attachment_id 继续转发或展示。

## 用 doorbell 等文件

把下面这样的完整源码传给 `doorbell_create.script`。Runner 在你的工作目录启动脚本，并提供 Python SDK。工作目录以外的路径请写清楚，脚本不会继承项目自定义的环境变量。

```python
#!/usr/bin/env python3
from pathlib import Path
from doorbell import every, ring, state

@every(seconds=60)
def check():
    report = Path("results/report.json").resolve()
    if report.is_file():
        version = str(report.stat().st_mtime_ns)
        if state.get("reported") != version:
            ring(prompt=f"结果文件已更新，请读取 {report} 并向父节点汇报。", dedup_key=version)
            state.set("reported", version)
```

先用 python3 单独验证文件检查逻辑。装饰器在脚本顶层返回后立即开始第一次检查，顶层应保持畅通。每个事件用稳定的 dedup_key，成功 ring 后再保存游标。用 `doorbell_list` 确认运行状态，用 `doorbell_logs` 查看错误。工作交付后删除监听。

## 删除

`agent_delete` 遇到有后代的节点会返回子树预览。确认整棵子树都应删除后，用返回的 subtree_version 和 `force: true` 重试。子树变化后需重新查看预览。工作目录和产物保留。离线机器的收尾进度见 `agent_delete_status`。
