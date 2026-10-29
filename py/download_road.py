import osmnx as ox

print("开始下载武汉市道路网络...")

G = ox.graph_from_place(
    "Wuhan, China",
    network_type="drive"
)

print("下载完成！")
print("节点数量：", len(G.nodes))
print("边数量：", len(G.edges))

# 保存到本地
ox.io.save_graphml(
    G,
    "wuhan_drive.graphml"
)

print("路网已经保存为 wuhan_drive.graphml")